import * as vscode from 'vscode';
import { relationStore } from './sync/ClassRelationStore';

export class InheritanceNode extends vscode.TreeItem {
    constructor(
        public readonly name: string,
        public readonly parentName: string | null,
        public readonly hasVtable: boolean,
        public readonly headerUri: vscode.Uri,
        hasChildren: boolean,
        public readonly isInterface: boolean = false  // 新增
    ) {
        super(
            name,
            hasChildren
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
        );
        this.description = parentName ? `extends ${parentName}` : '';
        this.command = {
            command: 'vscode.open',
            title: 'Open header',
            arguments: [headerUri]
        };
    }
}

export class InheritanceTreeDataProvider implements vscode.TreeDataProvider<InheritanceNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<InheritanceNode | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this.extensionUri = extensionUri;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: InheritanceNode): vscode.TreeItem {
        // 设置图标
        let iconName: string;
        if (element.isInterface) {
            iconName = 'interface.svg';   // 接口专用图标
        } else {
            iconName = element.hasVtable ? 'vtable-has.svg' : 'vtable-none.svg';
        }
        element.iconPath = {
            light: vscode.Uri.joinPath(this.extensionUri, 'resources', iconName),
            dark: vscode.Uri.joinPath(this.extensionUri, 'resources', iconName),
        };

        // 描述信息（继承关系 + vtable 状态）
        const parts: string[] = [];
        if (element.parentName) {
            parts.push(`extends ${element.parentName}`);
        }
        parts.push(element.hasVtable ? '[vtable]' : '[no vtable]');
        element.description = parts.join(' ');

        // 构建悬停提示（工具提示）
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${element.name}**\n\n`);
        md.appendMarkdown(`- File: \`${element.headerUri.fsPath}\`\n`);
        md.appendMarkdown(`- Vtable: ${element.hasVtable ? '✅ Yes' : '❌ No'}\n`);
        if (element.parentName) {
            md.appendMarkdown(`- Parent: \`${element.parentName}\`\n`);
        } else {
            md.appendMarkdown(`- Root class\n`);
        }
        // 暂时不显示虚函数列表，以后可从缓存扩展
        element.tooltip = md;

        return element;
    }

    getChildren(element?: InheritanceNode): vscode.ProviderResult<InheritanceNode[]> {
        if (!element) {
            // 根节点
            const roots = relationStore.getRoots();
            return roots.map(name => this.createNode(name)).filter(n => n !== null) as InheritanceNode[];
        } else {
            // 子节点
            const children = relationStore.getDirectChildren(element.name);
            return children.map(name => this.createNode(name)).filter(n => n !== null) as InheritanceNode[];
        }
    }

    private createNode(className: string): InheritanceNode | null {
        const entry = relationStore.getClass(className);
        if (!entry) return null;
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!root) return null;
        const uri = vscode.Uri.joinPath(root, entry.file);
        const hasChildren = entry.children && entry.children.length > 0;
        return new InheritanceNode(className, entry.parent, entry.hasVtable, uri, hasChildren, entry.isInterface);
    }

    public async getAllClasses(): Promise<InheritanceNode[]> {
        const classNames = relationStore.getAllClassNames();
        const nodes: InheritanceNode[] = [];
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!workspaceRoot) return nodes;

        for (const className of classNames) {
            const entry = relationStore.getClass(className);
            if (!entry) continue;
            const uri = vscode.Uri.joinPath(workspaceRoot, entry.file);
            const hasChildren = entry.children && entry.children.length > 0;
            const node = new InheritanceNode(className, entry.parent, entry.hasVtable, uri, hasChildren, entry.isInterface);
            nodes.push(node);
        }
        return nodes;
    }
}