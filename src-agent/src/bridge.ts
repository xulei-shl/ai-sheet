export class BridgeClient {
  private baseUrl: string;

  constructor(port: number) {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`Bridge request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { error?: string } & T;
    if (data.error) {
      throw new Error(`Bridge error: ${data.error}`);
    }

    return data;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async getDefaultModel(): Promise<{
    providerType: string;
    modelId: string;
    name?: string;
    apiKey?: string;
    baseUrl?: string;
  }> {
    return this.post('/api/config/default');
  }

  async getAllModels(): Promise<Array<{ providerType: string; modelId: string; name: string }>> {
    return this.get('/api/config/models');
  }
}
