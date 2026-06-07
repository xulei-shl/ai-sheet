export interface Prompt {
  id: string;
  name: string;
  content: string;
  category?: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromptInput {
  name: string;
  content: string;
  category?: string;
}
