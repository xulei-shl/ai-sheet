use crate::models::config::{DefaultModel, ModelConfig};

pub const DEFAULT_MODELS: &[DefaultModel] = &[
    DefaultModel {
        name: "DeepSeek-V3 (默认免费)",
        base_url: "https://api.deepseek.com/v1",
        model_id: "deepseek-chat",
        provider_type: "openai-completions",
    },
    DefaultModel {
        name: "GLM-4-Flash (备用免费)",
        base_url: "https://open.bigmodel.cn/api/paas/v4",
        model_id: "glm-4-flash",
        provider_type: "openai-completions",
    },
];

#[derive(Debug, Default)]
pub struct ConfigService;

impl ConfigService {
    pub fn get_active_model(&self) -> ModelConfig {
        DEFAULT_MODELS[0].to_model_config(true)
    }

    pub fn get_fallback_chain(&self) -> Vec<ModelConfig> {
        DEFAULT_MODELS
            .iter()
            .enumerate()
            .map(|(index, model)| model.to_model_config(index == 0))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_active_model() {
        let service = ConfigService;
        let model = service.get_active_model();
        assert_eq!(model.name, "DeepSeek-V3 (默认免费)");
        assert!(model.is_default);
        assert_eq!(model.provider_type, "openai-completions");
    }

    #[test]
    fn test_fallback_chain() {
        let service = ConfigService;
        let chain = service.get_fallback_chain();
        assert_eq!(chain.len(), 2);
        assert!(chain[0].is_default);
        assert!(!chain[1].is_default);
        assert_eq!(chain[1].model_id, "glm-4-flash");
    }

    #[test]
    fn test_default_model_data() {
        assert_eq!(DEFAULT_MODELS.len(), 2);
        assert_eq!(DEFAULT_MODELS[0].name, "DeepSeek-V3 (默认免费)");
        assert_eq!(DEFAULT_MODELS[1].name, "GLM-4-Flash (备用免费)");
    }

    #[test]
    fn test_to_model_config() {
        let d = &DEFAULT_MODELS[0];
        let config = d.to_model_config(true);
        assert_eq!(config.name, d.name);
        assert_eq!(config.base_url, d.base_url);
        assert_eq!(config.model_id, d.model_id);
        assert_eq!(config.provider_type, d.provider_type);
        assert!(config.is_default);
        assert!(config.id.is_none());
        assert!(config.api_key.is_empty());
    }
}
