import axios, { type AxiosInstance, type AxiosError } from 'axios';
import { logger } from '../lib/logger.js';

interface AriOriginateParams {
  endpoint: string;
  extension?: string;
  context?: string;
  priority?: number;
  app?: string;
  appArgs?: string;
  callerId?: string;
  timeout?: number;
  channelId?: string;
  variables?: Record<string, string>;
}

interface AriChannel {
  id: string;
  name: string;
  state: string;
}

interface AriPlayback {
  id: string;
  media_uri: string;
  state: string;
}

interface AriBridge {
  id: string;
  bridge_type: string;
  channels: string[];
}

export class AriClient {
  private readonly http: AxiosInstance;
  private readonly appName: string;

  constructor() {
    const host = process.env['ARI_HOST'] ?? 'localhost';
    const port = process.env['ARI_PORT'] ?? '8088';
    const user = process.env['ARI_USERNAME'] ?? 'dialer';
    const pass = process.env['ARI_PASSWORD'] ?? '';
    const tls = process.env['ARI_TLS'] === 'true';
    this.appName = process.env['ARI_APP_NAME'] ?? 'dialer';

    const baseURL = `${tls ? 'https' : 'http'}://${host}:${port}/ari`;

    this.http = axios.create({
      baseURL,
      auth: { username: user, password: pass },
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });

    // Log all ARI requests at trace level
    this.http.interceptors.request.use((config) => {
      logger.trace(
        { method: config.method?.toUpperCase(), url: config.url },
        'ARI request',
      );
      return config;
    });
  }

  /**
   * Originate an outbound call channel.
   * Returns the newly created channel or throws on failure.
   */
  async originateCall(params: AriOriginateParams): Promise<AriChannel> {
    const body = {
      endpoint: params.endpoint,
      app: params.app ?? this.appName,
      appArgs: params.appArgs ?? '',
      callerId: params.callerId,
      timeout: params.timeout ?? 30,
      channelId: params.channelId,
      variables: params.variables ?? {},
    };

    try {
      const { data } = await this.http.post<AriChannel>('/channels', body);
      logger.info(
        { channelId: data.id, endpoint: params.endpoint },
        'ARI originate succeeded',
      );
      return data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      logger.error(
        {
          endpoint: params.endpoint,
          status: axiosErr.response?.status,
          data: axiosErr.response?.data,
        },
        'ARI originate failed',
      );
      throw new Error(
        `ARI originate failed for ${params.endpoint}: ${axiosErr.message}`,
      );
    }
  }

  /**
   * Hang up a channel by ID.
   */
  async hangupChannel(
    channelId: string,
    reason: string = 'normal',
  ): Promise<void> {
    try {
      await this.http.delete(`/channels/${channelId}`, {
        params: { reason },
      });
      logger.info({ channelId, reason }, 'ARI hangup sent');
    } catch (err) {
      const axiosErr = err as AxiosError;
      // 404 means already hung up — not an error
      if (axiosErr.response?.status === 404) {
        logger.debug({ channelId }, 'ARI hangup: channel already gone');
        return;
      }
      logger.error({ channelId, err }, 'ARI hangup failed');
      throw err;
    }
  }

  /**
   * Get a channel variable value.
   */
  async getChannelVariable(
    channelId: string,
    variable: string,
  ): Promise<string | null> {
    try {
      const { data } = await this.http.get<{ value: string }>(
        `/channels/${channelId}/variable`,
        { params: { variable } },
      );
      return data.value;
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response?.status === 404) return null;
      throw err;
    }
  }

  /**
   * Set a channel variable.
   */
  async setChannelVariable(
    channelId: string,
    variable: string,
    value: string,
  ): Promise<void> {
    await this.http.post(`/channels/${channelId}/variable`, {
      variable,
      value,
    });
  }

  /**
   * Play audio on a channel. Returns playback ID.
   */
  async playAudio(
    channelId: string,
    media: string, // e.g. "sound:welcome" or "recording:custom.wav"
    lang: string = 'en',
  ): Promise<AriPlayback> {
    const { data } = await this.http.post<AriPlayback>(
      `/channels/${channelId}/play`,
      { media, lang },
    );
    logger.debug({ channelId, media }, 'ARI play started');
    return data;
  }

  /**
   * Stop a playback on a channel.
   */
  async stopPlayback(playbackId: string): Promise<void> {
    try {
      await this.http.delete(`/playbacks/${playbackId}`);
    } catch {
      // ignore if already done
    }
  }

  /**
   * Create a mixing bridge and return bridge ID.
   */
  async createBridge(
    type: string = 'mixing',
    name?: string,
  ): Promise<AriBridge> {
    const { data } = await this.http.post<AriBridge>('/bridges', {
      type,
      name,
    });
    logger.info({ bridgeId: data.id }, 'ARI bridge created');
    return data;
  }

  /**
   * Add channels to a bridge.
   */
  async addChannelsToBridge(
    bridgeId: string,
    channelIds: string[],
  ): Promise<void> {
    await this.http.post(`/bridges/${bridgeId}/addChannel`, {
      channel: channelIds.join(','),
    });
    logger.info({ bridgeId, channelIds }, 'Channels added to bridge');
  }

  /**
   * Destroy a bridge.
   */
  async destroyBridge(bridgeId: string): Promise<void> {
    try {
      await this.http.delete(`/bridges/${bridgeId}`);
      logger.info({ bridgeId }, 'ARI bridge destroyed');
    } catch {
      // ignore if already gone
    }
  }

  /**
   * Originate a call to an agent's SIP endpoint.
   * Returns the agent channel.
   */
  async originateToAgent(params: {
    sipEndpoint: string;
    callerId: string;
    channelId?: string;
    variables?: Record<string, string>;
  }): Promise<AriChannel> {
    return this.originateCall({
      endpoint: params.sipEndpoint,
      app: this.appName,
      appArgs: 'agent_leg',
      callerId: params.callerId,
      timeout: 30,
      // exactOptionalPropertyTypes: only include optional fields when defined
      ...(params.channelId !== undefined ? { channelId: params.channelId } : {}),
      ...(params.variables !== undefined ? { variables: params.variables } : {}),
    });
  }

  /**
   * List all active channels in the Stasis application.
   * Used to recover state after reconnect.
   */
  async listChannels(): Promise<AriChannel[]> {
    const { data } = await this.http.get<AriChannel[]>('/channels');
    return data;
  }
}
