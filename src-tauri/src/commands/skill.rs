use std::fs;
use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::error::AppResult;
use crate::models::skill::{FileNode, SkillDetail, SkillInfo, SkillInput};

fn skills_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(data_dir.join(".pi").join("skills"))
}

fn parse_frontmatter(raw: &str) -> (String, String) {
    let trimmed = raw.trim_start();
    if !trimmed.starts_with("---") {
        return (String::new(), String::new());
    }
    let after_first = &trimmed[3..];
    if let Some(end) = after_first.find("\n---") {
        let frontmatter = &after_first[..end];
        let mut name = String::new();
        let mut description = String::new();
        for line in frontmatter.lines() {
            let line = line.trim();
            if let Some(v) = line.strip_prefix("name:") {
                name = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("description:") {
                description = v.trim().to_string();
            }
        }
        return (name, description);
    }
    (String::new(), String::new())
}

fn split_frontmatter(raw: &str) -> (String, String) {
    let trimmed = raw.trim_start();
    if !trimmed.starts_with("---") {
        return (String::new(), raw.to_string());
    }
    let after_first = &trimmed[3..];
    if let Some(end) = after_first.find("\n---") {
        let content = after_first[end + 4..].trim_start().to_string();
        return (content, raw.to_string());
    }
    (String::new(), raw.to_string())
}

fn build_dir_tree(dir: &PathBuf, base: &PathBuf) -> AppResult<Vec<FileNode>> {
    let mut nodes = Vec::new();
    let entries = fs::read_dir(dir).map_err(|e| {
        crate::error::AppError::Service(format!("Failed to read dir {}: {}", dir.display(), e))
    })?;

    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by(|a, b| {
        let a_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        b_dir.cmp(&a_dir).then(a.file_name().cmp(&b.file_name()))
    });

    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let relative = path.strip_prefix(base).unwrap_or(&path);
        let relative_str = relative.to_string_lossy().to_string();

        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            let children = build_dir_tree(&path, base)?;
            nodes.push(FileNode {
                name,
                path: relative_str,
                is_dir: true,
                children,
            });
        } else {
            nodes.push(FileNode {
                name,
                path: relative_str,
                is_dir: false,
                children: vec![],
            });
        }
    }
    Ok(nodes)
}

fn validate_skill_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Skill name cannot be empty".into());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(
            "Skill name can only contain lowercase letters, digits, and hyphens".into(),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn list_skills(app: tauri::AppHandle) -> Result<Vec<SkillInfo>, String> {
    let dir = skills_dir(&app)?;
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut result = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let skill_file = path.join("SKILL.md");
        if !skill_file.exists() {
            continue;
        }

        let raw = fs::read_to_string(&skill_file).map_err(|e| e.to_string())?;
        let (name, description) = parse_frontmatter(&raw);
        let dir_name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        result.push(SkillInfo {
            name: if name.is_empty() {
                dir_name
            } else {
                name
            },
            description,
        });
    }

    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

#[tauri::command]
pub fn read_skill(app: tauri::AppHandle, name: String) -> Result<SkillDetail, String> {
    let skill_dir = skills_dir(&app)?.join(&name);
    let skill_file = skill_dir.join("SKILL.md");

    if !skill_file.exists() {
        return Err(format!("Skill '{}' not found", name));
    }

    let raw = fs::read_to_string(&skill_file).map_err(|e| e.to_string())?;
    let (parsed_name, parsed_desc) = parse_frontmatter(&raw);
    let (content, _) = split_frontmatter(&raw);

    Ok(SkillDetail {
        name: if parsed_name.is_empty() {
            name
        } else {
            parsed_name
        },
        description: parsed_desc,
        content,
        raw,
    })
}

#[tauri::command]
pub fn read_skill_file(
    app: tauri::AppHandle,
    name: String,
    file_path: String,
) -> Result<String, String> {
    let skill_dir = skills_dir(&app)?.join(&name);
    let full_path = skill_dir.join(&file_path);

    let canonical_skill = skill_dir
        .canonicalize()
        .map_err(|e| format!("Invalid skill dir: {}", e))?;
    let canonical_file = full_path
        .canonicalize()
        .map_err(|e| format!("Invalid file path: {}", e))?;

    if !canonical_file.starts_with(&canonical_skill) {
        return Err("Path traversal not allowed".into());
    }

    if !canonical_file.exists() {
        return Err(format!("File '{}' not found", file_path));
    }

    fs::read_to_string(&canonical_file).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_skill_files(
    app: tauri::AppHandle,
    name: String,
) -> Result<Vec<FileNode>, String> {
    let skill_dir = skills_dir(&app)?.join(&name);

    if !skill_dir.exists() {
        return Err(format!("Skill '{}' not found", name));
    }

    build_dir_tree(&skill_dir, &skill_dir).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_skill(app: tauri::AppHandle, input: SkillInput) -> Result<SkillInfo, String> {
    validate_skill_name(&input.name)?;

    let skill_dir = skills_dir(&app)?.join(&input.name);
    if skill_dir.exists() {
        return Err(format!("Skill '{}' already exists", input.name));
    }

    fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;

    let content = if input.content.trim().is_empty() {
        String::new()
    } else {
        format!("\n{}\n", input.content.trim())
    };

    let skill_md = format!(
        "---\nname: {}\ndescription: {}\n---{}\n",
        input.name, input.description, content
    );

    let skill_file = skill_dir.join("SKILL.md");
    fs::write(&skill_file, &skill_md).map_err(|e| e.to_string())?;

    Ok(SkillInfo {
        name: input.name,
        description: input.description,
    })
}

#[tauri::command]
pub fn delete_skill(app: tauri::AppHandle, name: String) -> Result<(), String> {
    validate_skill_name(&name)?;

    let skill_dir = skills_dir(&app)?.join(&name);
    if !skill_dir.exists() {
        return Err(format!("Skill '{}' not found", name));
    }

    let canonical_skills = skills_dir(&app)?
        .canonicalize()
        .map_err(|e| format!("Invalid skills dir: {}", e))?;
    let canonical_skill = skill_dir
        .canonicalize()
        .map_err(|e| format!("Invalid skill dir: {}", e))?;

    if !canonical_skill.starts_with(&canonical_skills) {
        return Err("Path traversal not allowed".into());
    }

    fs::remove_dir_all(&skill_dir).map_err(|e| e.to_string())
}

fn ensure_under_skill_dir(skill_dir: &Path, target: &Path) -> Result<PathBuf, String> {
    let canonical_skill = skill_dir
        .canonicalize()
        .map_err(|e| format!("Invalid skill dir: {}", e))?;
    let canonical_target = target
        .canonicalize()
        .map_err(|e| format!("Invalid path: {}", e))?;
    if !canonical_target.starts_with(&canonical_skill) {
        return Err("Path traversal not allowed".into());
    }
    Ok(canonical_target)
}

#[tauri::command]
pub fn update_skill_file(
    app: tauri::AppHandle,
    name: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    let skill_dir = skills_dir(&app)?.join(&name);
    if !skill_dir.exists() {
        return Err(format!("Skill '{}' not found", name));
    }

    let target = skill_dir.join(&file_path);
    let canonical = ensure_under_skill_dir(&skill_dir, &target)?;
    if !canonical.is_file() {
        return Err(format!("'{}' is not a file", file_path));
    }

    fs::write(&canonical, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_skill_file(
    app: tauri::AppHandle,
    name: String,
    file_path: String,
) -> Result<(), String> {
    let skill_dir = skills_dir(&app)?.join(&name);
    if !skill_dir.exists() {
        return Err(format!("Skill '{}' not found", name));
    }

    let target = skill_dir.join(&file_path);
    let canonical = ensure_under_skill_dir(&skill_dir, &target)?;

    if canonical.is_file() {
        fs::remove_file(&canonical).map_err(|e| e.to_string())
    } else if canonical.is_dir() {
        fs::remove_dir_all(&canonical).map_err(|e| e.to_string())
    } else {
        Err(format!("'{}' not found", file_path))
    }
}

#[tauri::command]
pub fn create_skill_file(
    app: tauri::AppHandle,
    name: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    let skill_dir = skills_dir(&app)?.join(&name);
    if !skill_dir.exists() {
        return Err(format!("Skill '{}' not found", name));
    }

    let target = skill_dir.join(&file_path);

    // Ensure parent directories exist
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Safety: after creating parents, verify path is still under skill dir
    // (only if file doesn't exist yet — canonicalize won't work on non-existent files)
    if target.exists() {
        let canonical = ensure_under_skill_dir(&skill_dir, &target)?;
        if canonical.exists() {
            return Err(format!("File '{}' already exists", file_path));
        }
    } else {
        // Verify parent is under skill dir
        if let Some(parent) = target.parent() {
            if parent.exists() {
                let _ = ensure_under_skill_dir(&skill_dir, parent)?;
            }
        }
    }

    fs::write(&target, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_skill_from_folder(
    app: tauri::AppHandle,
    source_path: String,
    skill_name: Option<String>,
) -> Result<SkillInfo, String> {
    let source = PathBuf::from(&source_path);
    if !source.exists() || !source.is_dir() {
        return Err("Source path is not a valid directory".into());
    }

    // Determine skill name: use provided name, or fall back to folder name
    let name = skill_name.unwrap_or_else(|| {
        source
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string()
    });
    validate_skill_name(&name)?;

    let skill_dir = skills_dir(&app)?.join(&name);
    if skill_dir.exists() {
        return Err(format!("Skill '{}' already exists", name));
    }

    // Copy entire directory tree
    copy_dir_recursive(&source, &skill_dir)?;

    // If no SKILL.md exists, create one from the skill name
    let skill_file = skill_dir.join("SKILL.md");
    if !skill_file.exists() {
        let skill_md = format!(
            "---\nname: {}\ndescription: Imported from {}\n---\n",
            name, source_path
        );
        fs::write(&skill_file, &skill_md).map_err(|e| e.to_string())?;
    }

    // Parse the (possibly existing) SKILL.md for return info
    let raw = fs::read_to_string(&skill_file).map_err(|e| e.to_string())?;
    let (parsed_name, parsed_desc) = parse_frontmatter(&raw);

    Ok(SkillInfo {
        name: if parsed_name.is_empty() {
            name
        } else {
            parsed_name
        },
        description: parsed_desc,
    })
}

fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;

    let entries = fs::read_dir(src).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
