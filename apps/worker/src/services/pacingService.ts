import type { Redis } from 'ioredis';
import { REDIS_KEYS, DEFAULTS } from '@dialer/shared';
import { logger } from '../lib/logger.js';

/**
 * ErlangCPacingService
 *
 * Implements Erlang-C based predictive dialing pacing.
 *
 * The Erlang-C formula determines the probability that an incoming call
 * (or in our case, an answered outbound call) has to wait for an agent.
 *
 *   C(N, A) =  [A^N / (N! * (1 - ρ))] / [Σ(k=0..N-1) A^k/k! + A^N / (N! * (1 - ρ))]
 *
 * Where:
 *   A = offered traffic in Erlangs = λ / μ
 *   N = number of agents
 *   ρ = A / N (server utilization)
 *   λ = call arrival rate (answered calls per second)
 *   μ = 1 / average handle time (rate per agent)
 *
 * We use this to compute the optimal origination rate that maintains
 * agent occupancy at TARGET_OCCUPANCY while keeping P(wait) < threshold.
 */
export class ErlangCPacingService {
  private readonly targetOccupancy: number;
  private readonly minCallsPerSecond: number;
  private readonly maxCallsPerSecond: number;
  private readonly windowSeconds: number;

  constructor(private readonly redis: Redis) {
    this.targetOccupancy = parseFloat(
      process.env['PACING_TARGET_OCCUPANCY'] ??
        String(DEFAULTS.PACING_TARGET_OCCUPANCY),
    );
    this.windowSeconds = parseInt(
      process.env['PACING_ANSWER_RATE_WINDOW_SECONDS'] ??
        String(DEFAULTS.PACING_ANSWER_RATE_WINDOW_SECONDS),
      10,
    );
    this.minCallsPerSecond = parseFloat(
      process.env['PACING_MIN_CALLS_PER_SECOND'] ?? '1',
    );
    this.maxCallsPerSecond = parseFloat(
      process.env['PACING_MAX_CALLS_PER_SECOND'] ?? '100',
    );
  }

  // ------------------------------------------------------------------
  // Erlang-C core math
  // ------------------------------------------------------------------

  /**
   * Compute Erlang-C: P(call has to wait) given N agents and offered load A.
   */
  private erlangC(N: number, A: number): number {
    if (N === 0) return 1;
    if (A <= 0) return 0;

    const rho = A / N;
    if (rho >= 1) return 1;

    // Use log-space to avoid overflow for large N (fixes ISSUE-16)
    let logFactorialN = 0;
    for (let i = 1; i <= N; i++) logFactorialN += Math.log(i);
    const logAn = N * Math.log(Math.max(A, 1e-9));
    const aN_over_Nfact = Math.exp(logAn - logFactorialN);

    // Guard overflow before using the value
    if (!isFinite(aN_over_Nfact)) return 1;

    let sum = 1; // k=0 term
    let term = 1;
    for (let k = 1; k < N; k++) {
      term *= A / k;
      sum += term;
      if (!isFinite(sum)) return 1; // overflow guard
    }

    const numerator  = aN_over_Nfact / (1 - rho);
    const denominator = sum + numerator;
    if (!isFinite(numerator) || denominator === 0) return 1;

    return numerator / denominator;
  }

  /**
   * Given available agents and current answer rate, compute the recommended
   * calls-per-second origination rate using Erlang-C.
   *
   * @param availableAgents  - Current number of available agents
   * @param answerRate       - Fraction of dialed calls answered (0..1)
   * @param avgHandleTimeSec - Average call handle time in seconds
   * @returns Recommended calls per second to dial
   */
  computeRecommendedRate(
    availableAgents: number,
    answerRate: number,
    avgHandleTimeSec: number,
  ): number {
    if (availableAgents <= 0 || answerRate <= 0) {
      return 0;
    }

    // μ = service rate per agent
    const mu = 1 / Math.max(avgHandleTimeSec, 1);

    // Target offered load A = N * targetOccupancy
    const targetA = availableAgents * this.targetOccupancy;

    // Required answered call rate λ = A * μ
    const targetAnsweredRate = targetA * mu;

    // To achieve targetAnsweredRate with current answerRate,
    // we need to originate at: λ_originate = λ_answered / answerRate
    let recommendedRate = targetAnsweredRate / answerRate;

    // Binary search to find minimum N that satisfies Erlang-C target
    // This self-corrects if P(wait) would be too high
    const A = targetAnsweredRate / mu;
    const pWait = this.erlangC(availableAgents, A);
    const serviceLevelTarget = parseFloat(
      process.env['PACING_SERVICE_LEVEL_TARGET'] ?? '0.95',
    );

    if (pWait > 1 - serviceLevelTarget) {
      // Too much wait probability — reduce rate by 10%
      recommendedRate *= 0.9;
      logger.debug(
        { pWait, serviceLevelTarget, reducedRate: recommendedRate },
        'Pacing: high P(wait) — reducing rate',
      );
    }

    // ISSUE-16: Guard against NaN/Infinity from Erlang-C overflow (large N or A=0)
    if (!isFinite(recommendedRate) || isNaN(recommendedRate)) {
      logger.warn({ availableAgents, answerRate, avgHandleTimeSec }, 'Erlang-C overflow — using safe minimum');
      recommendedRate = this.minCallsPerSecond;
    }

    return Math.min(Math.max(recommendedRate, this.minCallsPerSecond), this.maxCallsPerSecond);
  }

  // ------------------------------------------------------------------
  // Redis-backed rolling answer rate tracking
  // ------------------------------------------------------------------

  /**
   * Record a dialed call event (hit or miss) into the rolling window.
   * Uses a Redis sorted set keyed by timestamp.
   */
  async recordDialAttempt(
    campaignId: string,
    answered: boolean,
  ): Promise<void> {
    const key = REDIS_KEYS.ANSWER_RATE_WINDOW(campaignId);
    const now = Date.now();

    await this.redis
      .pipeline()
      // score = timestamp, member = "timestamp:answered"
      .zadd(key, now, `${now}:${answered ? '1' : '0'}`)
      // Evict records outside the window
      .zremrangebyscore(key, '-inf', now - this.windowSeconds * 1000)
      .expire(key, this.windowSeconds * 2)
      .exec();
  }

  /**
   * Compute the empirical answer rate over the rolling window.
   * Returns a value in [0, 1]; defaults to 0.3 if not enough data.
   */
  async getAnswerRate(campaignId: string): Promise<number> {
    const key = REDIS_KEYS.ANSWER_RATE_WINDOW(campaignId);
    const now = Date.now();
    const windowStart = now - this.windowSeconds * 1000;

    const members = await this.redis.zrangebyscore(
      key,
      windowStart,
      '+inf',
    );

    if (members.length < 10) {
      // Insufficient data — use conservative estimate
      return 0.3;
    }

    const answered = members.filter((m) => m.endsWith(':1')).length;
    const rate = answered / members.length;

    logger.trace(
      { campaignId, total: members.length, answered, rate },
      'Answer rate computed',
    );

    return rate;
  }

  /**
   * Store campaign-level average handle time (updated by listener service).
   */
  async setAvgHandleTime(
    campaignId: string,
    seconds: number,
  ): Promise<void> {
    await this.redis.set(
      `pacing:aht:${campaignId}`,
      seconds.toFixed(2),
      'EX',
      3600,
    );
  }

  async getAvgHandleTime(campaignId: string): Promise<number> {
    const val = await this.redis.get(`pacing:aht:${campaignId}`);
    // Default: 60 seconds if no data yet
    return val ? parseFloat(val) : 60;
  }
}
