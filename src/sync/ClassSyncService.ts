import * as vscode from 'vscode';
import { relationStore, ClassEntry } from './ClassRelationStore';

export class ClassSyncService {
    private disposables: vscode.Disposable[] = [];
    private _onRelationsChanged = new vscode.EventEmitter<void>();
    readonly onRelationsChanged = this._onRelationsChanged.event;

    constructor() {
        // 监听文件重命名/移动
        this.disposables.push(
            vscode.workspace.onDidRenameFiles(this.handleFileRename.bind(this))
        );
        // 监听文件删除
        this.disposables.push(
            vscode.workspace.onDidDeleteFiles(this.handleFileDelete.bind(this))
        );
        // 监听文件内容变化（仅对已记录的 .h 文件做轻量检查）
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(this.handleDocumentChange.bind(this))
        );
    }

    /** 初始化：加载关系表，并启动文件监听 */
    async initialize(): Promise<void> {
        await relationStore.load();
        // 无需主动触发刷新，监听器会处理后续变更
        this._onRelationsChanged.fire();
    }

    private async handleFileRename(event: vscode.FileRenameEvent) {
        let changed = false;
        for (const file of event.files) {
            const oldRelative = vscode.workspace.asRelativePath(file.oldUri);
            const newRelative = vscode.workspace.asRelativePath(file.newUri);
            // 查找所有包含 oldRelative 路径的类，更新为新路径
            for (const [name, entry] of (relationStore as any).data as Map<string, ClassEntry>) {
                if (entry.file === oldRelative) {
                    relationStore.updateFilePath(name, newRelative);
                    changed = true;
                }
            }
        }
        if (changed) {
            await relationStore.save();
            this._onRelationsChanged.fire();
        }
    }

    private async handleFileDelete(event: vscode.FileDeleteEvent) {
        let changed = false;
        for (const uri of event.files) {
            const relativePath = vscode.workspace.asRelativePath(uri);
            // 查找所有 file 字段匹配的类，删除之
            for (const [name, entry] of (relationStore as any).data as Map<string, ClassEntry>) {
                if (entry.file === relativePath) {
                    relationStore.removeClass(name);
                    changed = true;
                }
            }
        }
        if (changed) {
            await relationStore.save();
            this._onRelationsChanged.fire();
        }
    }

    private async handleDocumentChange(event: vscode.TextDocumentChangeEvent) {
        if (event.document.languageId !== 'c' && event.document.languageId !== 'cpp') return;
        const uri = event.document.uri;
        const relativePath = vscode.workspace.asRelativePath(uri);
        // 只处理已记录的文件
        const tracked = relationStore.getAllTrackedFiles();
        if (!tracked.includes(relativePath)) return;

        // 简单检查：该文件中包含的类是否还存在？父类是否改变？
        // 由于我们无法直接通过文档变化确定具体哪个类变了，这里采用保守策略：
        // 重新解析该文件中的所有类，并更新关系表（如果需要）。
        // 为了简单且不引入大量 AST 解析，我们仅通知视图刷新，让用户手动触发刷新或依赖命令更新。
        // 更好的做法是在这里进行轻量级检查，但为了避免复杂性，暂时只触发界面刷新。
        this._onRelationsChanged.fire();
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
    }

    /**
     * 供外部业务调用的统一注册接口
     * @param className 类名
     * @param relativePath 相对于工作区根目录的头文件路径
     * @param parentName 父类名（null 表示基类）
     * @param hasVtable 是否已有虚表
     */
    public async registerClass(className: string, relativePath: string, parentName: string | null, hasVtable: boolean,
         isInterface: boolean = false  // 新增
    ): Promise<void> {
        relationStore.setClass(className, relativePath, parentName, hasVtable, isInterface);
        await relationStore.save();
        setTimeout(() => this._onRelationsChanged.fire(), 0);
    }
}

export const syncService = new ClassSyncService();