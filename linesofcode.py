from pathlib import Path

# =========================
# CONFIGURATION
# =========================

PROJECT_DIR = Path(".")

# Extension -> Language
LANGUAGES = {
    ".html": "HTML",
    ".htm": "HTML",
    ".css": "CSS",
    ".js": "JavaScript",
    ".jsx": "JavaScript JSX",
    ".ts": "TypeScript",
    ".tsx": "TypeScript JSX",
    ".py": "Python",
    ".java": "Java",
    ".c": "C",
    ".h": "C/C++ Header",
    ".cpp": "C++",
    ".hpp": "C++ Header",
    ".cs": "C#",
    ".go": "Go",
    ".rs": "Rust",
    ".php": "PHP",
    ".rb": "Ruby",
    ".swift": "Swift",
    ".kt": "Kotlin",
    ".kts": "Kotlin",
    ".dart": "Dart",
    ".vue": "Vue",
    ".svelte": "Svelte",
    ".sql": "SQL",
    ".sh": "Shell",
    ".bash": "Shell",
    ".bat": "Batch",
    ".ps1": "PowerShell",
    ".json": "JSON",
    ".xml": "XML",
    ".yaml": "YAML",
    ".yml": "YAML",
    ".md": "Markdown",
}

# Directories to ignore
IGNORE_DIRS = {
    ".git",
    ".github",
    "node_modules",
    "venv",
    ".venv",
    "env",
    ".env",
    "__pycache__",
    "dist",
    "build",
    "coverage",
    ".next",
    ".cache",
}

# Files to ignore
IGNORE_FILES = {
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
}


# =========================
# LINE COUNTER
# =========================

results = {}
total_lines = 0
total_files = 0


def count_lines(file_path):
    """Count non-empty lines in a file."""

    try:
        with open(
            file_path,
            "r",
            encoding="utf-8",
            errors="ignore"
        ) as file:
            return sum(1 for line in file if line.strip())

    except Exception:
        return 0


for file in PROJECT_DIR.rglob("*"):

    # Only process files
    if not file.is_file():
        continue

    # Ignore specific files
    if file.name in IGNORE_FILES:
        continue

    # Ignore files inside excluded directories
    if any(part in IGNORE_DIRS for part in file.parts):
        continue

    # Detect language
    language = LANGUAGES.get(file.suffix.lower())

    if not language:
        continue

    lines = count_lines(file)

    if language not in results:
        results[language] = {
            "files": 0,
            "lines": 0
        }

    results[language]["files"] += 1
    results[language]["lines"] += lines

    total_files += 1
    total_lines += lines


# =========================
# OUTPUT
# =========================

print()
print("=" * 60)
print("                 CODE LINE COUNTER")
print("=" * 60)
print()

# Sort by number of lines
sorted_results = sorted(
    results.items(),
    key=lambda x: x[1]["lines"],
    reverse=True
)

for language, data in sorted_results:

    file_word = "file" if data["files"] == 1 else "files"

    print(
        f"{language:<20}"
        f"{data['files']:>6} {file_word:<7}"
        f"{data['lines']:>12,} lines"
    )

print()
print("-" * 60)

file_word = "file" if total_files == 1 else "files"

print(
    f"{'TOTAL':<20}"
    f"{total_files:>6} {file_word:<7}"
    f"{total_lines:>12,} lines"
)

print("=" * 60)
print()