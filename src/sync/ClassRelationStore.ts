import * as vscode from 'vscode';
import * as path from 'path';

export interface ClassEntry {
    file: string;            // 相对工作区根目录的路径
    parent: string | null;   // 父类名
    children: string[];      // 直接子类名列表
    hasVtable: boolean;      // 是否已有虚表结构体定义
    isInterface: boolean;    // 是否为接口
}

export class ClassRelationStore {
    private data: Map<string, ClassEntry> = new Map();
    private workspaceRoot: string | undefined;

    constructor() {
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    /** 从 .vscode/class-relations.json 加载 */
    async load(): Promise<void> {
        if (!this.workspaceRoot) return;
        const filePath = this.getStorePath();
        try {
            const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            const json = JSON.parse(new TextDecoder().decode(raw));
            if (json?.entries) {
                this.data = new Map(Object.entries(json.entries));
            }
        } catch {
            // 文件不存在或损坏，忽略
        }
    }

    /** 保存到 .vscode/class-relations.json */
    async save(): Promise<void> {
        if (!this.workspaceRoot) return;
        const obj = {
            version: 1,
            entries: Object.fromEntries(this.data)
        };
        const filePath = this.getStorePath();
        const dir = path.dirname(filePath);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
        await vscode.workspace.fs.writeFile(
            vscode.Uri.file(filePath),
            new TextEncoder().encode(JSON.stringify(obj, null, 2))
        );
    }

    /** 添加或更新一个类条目，自动维护 parent 的 children */
    setClass(name: string, file: string, parent: string | null, hasVtable: boolean = false, isInterface: boolean = false): void {
        const existing = this.data.get(name);

        // 如果父类改变，从旧父类的 children 中移除
        if (existing && existing.parent && existing.parent !== parent) {
            const oldParent = this.data.get(existing.parent);
            if (oldParent && Array.isArray(oldParent.children)) {
                oldParent.children = oldParent.children.filter(c => c !== name);
            }
        }

        // 确保 children 始终是数组
        const entry: ClassEntry = {
            file,
            parent,
            children: existing?.children && Array.isArray(existing.children) ? existing.children : [],
            hasVtable,
            isInterface
        };
        this.data.set(name, entry);

        // 将自己加入新父类的 children
        if (parent) {
            const parentEntry = this.data.get(parent);
            if (parentEntry) {
                if (!parentEntry.children.includes(name)) {
                    parentEntry.children.push(name);
                }
            }
        }
    }

    /** 删除一个类，并清理关系 */
    removeClass(name: string): void {
        const entry = this.data.get(name);
        if (!entry) return;

        // 从父类中移除
        if (entry.parent) {
            const parent = this.data.get(entry.parent);
            if (parent && Array.isArray(parent.children)) {
                parent.children = parent.children.filter(c => c !== name);
            }
        }

        // 子类变成根类（或根据需求递归删除）
        for (const child of entry.children) {
            const childEntry = this.data.get(child);
            if (childEntry) {
                childEntry.parent = null;
            }
        }

        this.data.delete(name);
    }

    getClass(name: string): ClassEntry | undefined {
        return this.data.get(name);
    }

    /** 返回所有没有父类的类名 */
    getRoots(): string[] {
        const roots: string[] = [];
        for (const [name, entry] of this.data) {
            if (!entry.parent) {
                roots.push(name);
            }
        }
        return roots;
    }

    /** 获取直接子类 */
    getDirectChildren(name: string): string[] {
        return this.data.get(name)?.children ?? [];
    }

    /** 递归获取所有后代（BFS） */
    getAllDescendants(name: string): string[] {
        const result: string[] = [];
        const queue = [...this.getDirectChildren(name)];
        while (queue.length > 0) {
            const child = queue.shift()!;
            result.push(child);
            queue.push(...this.getDirectChildren(child));
        }
        return result;
    }

    /** 获取从指定类到根类的链条（数组顺序：最近父类 -> 根类） */
    getAncestorChain(name: string): ClassEntry[] {
        const chain: ClassEntry[] = [];
        let current = this.data.get(name);
        while (current && current.parent) {
            const parent = this.data.get(current.parent);
            if (!parent) break;
            chain.push(parent);
            current = parent;
        }
        return chain;
    }

    /** 更新某个类的文件路径（文件移动时使用） */
    updateFilePath(name: string, newFile: string): void {
        const entry = this.data.get(name);
        if (entry) {
            entry.file = newFile;
        }
    }

    /** 获取所有记录的文件相对路径 */
    getAllTrackedFiles(): string[] {
        const files = new Set<string>();
        for (const entry of this.data.values()) {
            files.add(entry.file);
        }
        return Array.from(files);
    }

    /** 获取所有已缓存的类名 */
    getAllClassNames(): string[] {
        return Array.from(this.data.keys());
    }

    private getStorePath(): string {
        return path.join(this.workspaceRoot!, '.vscode', 'class-relations.json');
    }
}

// 全局单例
export const relationStore = new ClassRelationStore();