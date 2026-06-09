export interface SkillInfo {
  name: string;
  description: string;
}

export interface SkillDetail {
  name: string;
  description: string;
  content: string;
  raw: string;
}

export interface SkillInput {
  name: string;
  description: string;
  content: string;
}

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[];
}
