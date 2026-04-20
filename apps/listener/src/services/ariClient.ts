/**
 * AriClient — local copy for apps/listener.
 *
 * Both apps/worker and apps/listener need an ARI REST client.
 * Rather than a hard relative cross-workspace import, each service
 * owns its own copy. The logic is identical; extract to a shared
 * package in a future iteration if it diverges.
 */
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

function formatAxiosErrorDetail(err: AxiosError): string {
  const status = err.response?.status;
  const responseData = err.response?.data;
  const responseText =
    responseData == null
      ? ''
      : typeof responseData === 'string'
        ? responseData
        : JSON.stringify(responseData);
  const parts = [err.message];
  if (status) parts.push(`HTTP ${status}`);
  if (responseText) parts.push(responseText.slice(0, 300));
  return parts.join(' | ');
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

    this.http.interceptors.request.use((config) => {
      logger.trace(
        { method: config.method?.toUpperCase(), url: config.url },
        'ARI request',
      );
      return config;
    });
  }

  async originateCall(params: AriOriginateParams): Promise<AriChannel> {
    const body: Record<string, unknown> = {
      endpoint: params.endpoint,
      app: params.app ?? this.appName,
      appArgs: params.appArgs ?? '',
      callerId: params.callerId,
      timeout: params.timeout ?? 30,
      variables: params.variables ?? {},
    };
    // exactOptionalPropertyTypes: only include channelId if defined
    if (params.channelId !== undefined) body['channelId'] = params.channelId;
    try {
      const { data } = await this.http.post<AriChannel>('/channels', body);
      logger.info({ channelId: data.id, endpoint: params.endpoint }, 'ARI originate succeeded');
      return data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      const detail = formatAxiosErrorDetail(axiosErr);
      logger.error(
        { endpoint: params.endpoint, status: axiosErr.response?.status, data: axiosErr.response?.data },
        'ARI originate failed',
      );
      throw new Error(`ARI originate failed for ${params.endpoint}: ${detail}`);
    }
  }

  async hangupChannel(channelId: string, reason = 'normal'): Promise<void> {
    try {
      await this.http.delete(`/channels/${channelId}`, { params: { reason } });
      logger.info({ channelId, reason }, 'ARI hangup sent');
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response?.status === 404) {
        logger.debug({ channelId }, 'ARI hangup: channel already gone');
        return;
      }
      throw err;
    }
  }

  async getChannelVariable(channelId: string, variable: string): Promise<string | null> {
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

  async setChannelVariable(channelId: string, variable: string, value: string): Promise<void> {
    await this.http.post(`/channels/${channelId}/variable`, { variable, value });
  }

  async playAudio(channelId: string, media: string, lang = 'en'): Promise<AriPlayback> {
    const { data } = await this.http.post<AriPlayback>(
      `/channels/${channelId}/play`,
      { media, lang },
    );
    logger.debug({ channelId, media }, 'ARI play started');
    return data;
  }

  async stopPlayback(playbackId: string): Promise<void> {
    try {
      await this.http.delete(`/playbacks/${playbackId}`);
    } catch { /* ignore if already done */ }
  }

  async createBridge(type = 'mixing', name?: string): Promise<AriBridge> {
    const { data } = await this.http.post<AriBridge>('/bridges', { type, name });
    logger.info({ bridgeId: data.id }, 'ARI bridge created');
    return data;
  }

  async addChannelsToBridge(bridgeId: string, channelIds: string[]): Promise<void> {
    await this.http.post(`/bridges/${bridgeId}/addChannel`, {
      channel: channelIds.join(','),
    });
  }

  async destroyBridge(bridgeId: string): Promise<void> {
    try {
      await this.http.delete(`/bridges/${bridgeId}`);
    } catch { /* ignore */ }
  }

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
      // exactOptionalPropertyTypes: use spread to avoid 'string | undefined' error
      ...(params.channelId !== undefined ? { channelId: params.channelId } : {}),
      ...(params.variables !== undefined ? { variables: params.variables } : {}),
    });
  }

  async listChannels(): Promise<AriChannel[]> {
    const { data } = await this.http.get<AriChannel[]>('/channels');
    return data;
  }
}
