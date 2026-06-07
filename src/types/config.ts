export interface ModelConfig {
  id?: number;
  name: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
  providerType: string;
  isDefault: boolean;
  source: 'builtInFallback' | 'user';
}
