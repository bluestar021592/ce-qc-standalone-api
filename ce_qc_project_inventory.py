# -*- coding: utf-8 -*-
"""
CE CCSL QC 项目只读盘点工具
用途：
1. 不上传整个项目源码，只导出项目结构、文件哈希、数据库结构、JSON结构。
2. 不复制数据库业务数据，不读取配置文件内容，不读取源代码内容。
3. 运行方式：把本工具放到当前QC监管APP项目根目录，双击“开始盘点.bat”。
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import platform
import sqlite3
import subprocess
import sys
import time
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path.cwd().resolve()
NOW = datetime.now().strftime("%Y%m%d_%H%M%S")
OUT = ROOT / f"CE_QC_项目盘点_{NOW}"

EXCLUDED_DIRS = {
    ".git", ".idea", ".vscode", "__pycache__", "node_modules",
    ".venv", "venv", "env", "dist", "build", ".next", "target",
    "cache", ".cache", "tmp", "temp", "logs", "log",
    "backups", "backup", "CE_QC_项目盘点工具", OUT.name
}

DB_EXTS = {".db", ".sqlite", ".sqlite3"}
JSON_EXTS = {".json"}
CODE_EXTS = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".vue", ".java", ".cs",
    ".go", ".rs", ".php", ".html", ".css", ".scss", ".sql",
    ".bat", ".cmd", ".ps1", ".sh"
}
CONFIG_NAMES = {
    "package.json", "requirements.txt", "pyproject.toml", "poetry.lock",
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
    "vite.config.js", "vite.config.ts", "next.config.js", "next.config.mjs",
    "tsconfig.json", "webpack.config.js", "electron-builder.yml",
    "docker-compose.yml", "docker-compose.yaml", "Dockerfile",
}
SENSITIVE_NAMES = {".env", ".env.local", ".env.production", ".env.development"}

MAX_HASH_SIZE = 1024 * 1024 * 1024  # 1GB
MAX_JSON_PARSE_SIZE = 50 * 1024 * 1024  # 50MB


def is_excluded(path: Path) -> bool:
    try:
        rel = path.relative_to(ROOT)
    except ValueError:
        return True
    return any(part in EXCLUDED_DIRS for part in rel.parts)


def sha256_file(path: Path) -> str:
    if path.stat().st_size > MAX_HASH_SIZE:
        return "SKIPPED_TOO_LARGE"
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def safe_rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def iter_files():
    for current, dirs, files in os.walk(ROOT):
        current_path = Path(current)
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS and not is_excluded(current_path / d)]
        for name in files:
            p = current_path / name
            if is_excluded(p):
                continue
            yield p


def json_shape(value: Any, depth: int = 0, max_depth: int = 4) -> Any:
    if depth >= max_depth:
        return {"type": type(value).__name__, "detail": "max_depth_reached"}
    if isinstance(value, dict):
        return {
            "type": "object",
            "key_count": len(value),
            "keys": {
                str(k): json_shape(v, depth + 1, max_depth)
                for k, v in list(value.items())[:100]
            },
        }
    if isinstance(value, list):
        result = {"type": "array", "length": len(value)}
        if value:
            result["first_item_shape"] = json_shape(value[0], depth + 1, max_depth)
        return result
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, int):
        return {"type": "integer"}
    if isinstance(value, float):
        return {"type": "number"}
    if isinstance(value, str):
        return {"type": "string", "length": len(value)}
    return {"type": type(value).__name__}


def export_db_report(db_path: Path, schema_dir: Path) -> dict:
    report = {
        "path": safe_rel(db_path),
        "size_bytes": db_path.stat().st_size,
        "sha256": sha256_file(db_path),
        "open_status": "PENDING",
        "integrity_check": None,
        "user_version": None,
        "journal_mode": None,
        "tables": [],
        "views": [],
        "triggers": [],
        "indexes": [],
        "errors": [],
    }
    try:
        uri = f"file:{db_path.as_posix()}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=10)
        conn.row_factory = sqlite3.Row
        report["open_status"] = "SUCCESS"

        try:
            report["integrity_check"] = conn.execute("PRAGMA integrity_check").fetchone()[0]
        except Exception as e:
            report["errors"].append(f"integrity_check: {e}")

        try:
            report["user_version"] = conn.execute("PRAGMA user_version").fetchone()[0]
            report["journal_mode"] = conn.execute("PRAGMA journal_mode").fetchone()[0]
        except Exception as e:
            report["errors"].append(f"pragma: {e}")

        objects = conn.execute("""
            SELECT type, name, tbl_name, sql
            FROM sqlite_master
            WHERE name NOT LIKE 'sqlite_%'
            ORDER BY type, name
        """).fetchall()

        schema_lines = [
            f"-- Database: {safe_rel(db_path)}",
            f"-- Exported at: {datetime.now().isoformat(timespec='seconds')}",
            "-- Schema only. No business row data is included.",
            ""
        ]

        for obj in objects:
            item = {
                "name": obj["name"],
                "table_name": obj["tbl_name"],
            }
            obj_type = obj["type"]
            if obj_type == "table":
                try:
                    cols = conn.execute(f'PRAGMA table_info("{obj["name"]}")').fetchall()
                    item["columns"] = [
                        {
                            "cid": c["cid"],
                            "name": c["name"],
                            "type": c["type"],
                            "notnull": c["notnull"],
                            "default": c["dflt_value"],
                            "pk": c["pk"],
                        }
                        for c in cols
                    ]
                    try:
                        count = conn.execute(f'SELECT COUNT(*) FROM "{obj["name"]}"').fetchone()[0]
                        item["row_count"] = count
                    except Exception as e:
                        item["row_count_error"] = str(e)
                except Exception as e:
                    item["columns_error"] = str(e)
                report["tables"].append(item)
            elif obj_type == "view":
                report["views"].append(item)
            elif obj_type == "trigger":
                report["triggers"].append(item)
            elif obj_type == "index":
                report["indexes"].append(item)

            if obj["sql"]:
                schema_lines.append(obj["sql"].rstrip(";") + ";\n")

        schema_name = safe_rel(db_path).replace("/", "__").replace("\\", "__") + ".schema.sql"
        (schema_dir / schema_name).write_text("\n".join(schema_lines), encoding="utf-8")
        conn.close()
    except Exception as e:
        report["open_status"] = "FAILED"
        report["errors"].append(str(e))
    return report


def write_tree(paths: list[Path], dest: Path):
    lines = [f"项目根目录：{ROOT}", f"生成时间：{datetime.now().isoformat(timespec='seconds')}", ""]
    for p in sorted(paths, key=lambda x: safe_rel(x).lower()):
        rel = safe_rel(p)
        level = rel.count("/")
        lines.append("  " * level + "└─ " + p.name)
    dest.write_text("\n".join(lines), encoding="utf-8")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    schema_dir = OUT / "database_schema"
    schema_dir.mkdir(parents=True, exist_ok=True)

    all_files = list(iter_files())

    # 1. 文件清单：仅路径、大小、时间、哈希，不读取源码内容
    manifest_path = OUT / "project_manifest.csv"
    with manifest_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow([
            "relative_path", "extension", "size_bytes",
            "modified_time", "sha256", "category"
        ])
        for p in sorted(all_files, key=lambda x: safe_rel(x).lower()):
            try:
                ext = p.suffix.lower()
                name = p.name
                if name in SENSITIVE_NAMES or name.startswith(".env"):
                    category = "SENSITIVE_CONFIG_NAME_ONLY"
                    digest = "NOT_HASHED"
                elif ext in DB_EXTS:
                    category = "DATABASE"
                    digest = sha256_file(p)
                elif ext in JSON_EXTS:
                    category = "JSON"
                    digest = sha256_file(p)
                elif ext in CODE_EXTS:
                    category = "SOURCE_CODE"
                    digest = sha256_file(p)
                elif name in CONFIG_NAMES:
                    category = "PROJECT_CONFIG"
                    digest = sha256_file(p)
                else:
                    category = "OTHER"
                    digest = sha256_file(p)
                writer.writerow([
                    safe_rel(p),
                    ext,
                    p.stat().st_size,
                    datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="seconds"),
                    digest,
                    category,
                ])
            except Exception as e:
                writer.writerow([safe_rel(p), p.suffix.lower(), "", "", f"ERROR:{e}", "ERROR"])

    # 2. 目录结构
    write_tree(all_files, OUT / "project_tree.txt")

    # 3. 环境信息
    env_info = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "project_root": str(ROOT),
        "os": platform.platform(),
        "python_version": sys.version,
        "machine": platform.machine(),
        "processor": platform.processor(),
    }
    try:
        env_info["git_version"] = subprocess.check_output(
            ["git", "--version"], stderr=subprocess.STDOUT, text=True, timeout=5
        ).strip()
    except Exception:
        env_info["git_version"] = "NOT_AVAILABLE"
    (OUT / "environment.json").write_text(
        json.dumps(env_info, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 4. 数据库结构盘点
    db_reports = []
    for p in all_files:
        if p.suffix.lower() in DB_EXTS:
            db_reports.append(export_db_report(p, schema_dir))
    (OUT / "database_report.json").write_text(
        json.dumps(db_reports, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 5. JSON结构盘点：不输出字段实际值
    json_reports = []
    for p in all_files:
        if p.suffix.lower() not in JSON_EXTS:
            continue
        item = {
            "path": safe_rel(p),
            "size_bytes": p.stat().st_size,
            "sha256": sha256_file(p),
        }
        if p.stat().st_size > MAX_JSON_PARSE_SIZE:
            item["status"] = "SKIPPED_TOO_LARGE"
        else:
            try:
                with p.open("r", encoding="utf-8-sig") as f:
                    data = json.load(f)
                item["status"] = "SUCCESS"
                item["shape"] = json_shape(data)
            except Exception as e:
                item["status"] = "FAILED"
                item["error"] = str(e)
        json_reports.append(item)
    (OUT / "json_structure_report.json").write_text(
        json.dumps(json_reports, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 6. 配置候选文件名，不复制内容
    config_candidates = []
    for p in all_files:
        if p.name in CONFIG_NAMES or p.name in SENSITIVE_NAMES or p.name.startswith(".env"):
            config_candidates.append({
                "path": safe_rel(p),
                "size_bytes": p.stat().st_size,
                "sensitive": p.name in SENSITIVE_NAMES or p.name.startswith(".env"),
            })
    (OUT / "config_candidates.json").write_text(
        json.dumps(config_candidates, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 7. 摘要
    summary = {
        "project_root": str(ROOT),
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "total_files": len(all_files),
        "database_files": len(db_reports),
        "json_files": len(json_reports),
        "source_code_files": sum(1 for p in all_files if p.suffix.lower() in CODE_EXTS),
        "config_candidate_files": len(config_candidates),
        "note": "本盘点包不包含源代码正文、数据库业务行数据、配置文件内容或密钥。",
    }
    (OUT / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # 8. 打包
    zip_path = ROOT / f"{OUT.name}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in OUT.rglob("*"):
            if p.is_file():
                zf.write(p, arcname=p.relative_to(OUT))

    print("")
    print("=" * 70)
    print("CE QC 项目只读盘点完成")
    print(f"输出目录：{OUT}")
    print(f"压缩包：  {zip_path}")
    print("请把生成的ZIP压缩包和连续3天日报Excel发回。")
    print("=" * 70)
    input("按回车键关闭窗口...")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"\n运行失败：{exc}")
        input("按回车键关闭窗口...")
        raise
