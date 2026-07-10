import * as vscode from 'vscode';
import { relationStore, ClassEntry } from './ClassRelationStore';

// 新增：文件变化事件的数据结构
export interface FileChangeEvent {
    /** 文件的 URI */
    uri: vscode.Uri;
    /** 相对于工作区根目录的路径 */
    relativePath: string;
    /** 变化类型 */
    type: 'changed' | 'renamed' | 'deleted';
    /** 仅当 type === 'renamed' 时存在，表示旧路径的 URI */
    oldUri?: vscode.Uri;
    /** 仅当 type === 'renamed' 时存在，表示旧路径的相对路径 */
    oldRelativePath?: string;
}

export class ClassSyncService {
    private disposables: vscode.Disposable[] = [];

    // 原有事件：关系表变化
    private _onRelationsChanged = new vscode.EventEmitter<void>();
    readonly onRelationsChanged = this._onRelationsChanged.event;

    // ★ 新增事件：任意文件变化
    private _onAnyFileChange = new vscode.EventEmitter<FileChangeEvent>();
    /** 订阅所有文件的变更（内容变化、重命名、删除），不区分文件类型 */
    readonly onAnyFileChange = this._onAnyFileChange.event;

    constructor() {
        // 监听文件重命名/移动
        this.disposables.push(
            vscode.workspace.onDidRenameFiles(this.handleFileRename.bind(this))
        );
        // 监听文件删除
        this.disposables.push(
            vscode.workspace.onDidDeleteFiles(this.handleFileDelete.bind(this))
        );
        // 监听文件内容变化
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(this.handleDocumentChange.bind(this))
        );
    }

    /** 初始化：加载关系表，并启动文件监听 */
    async initialize(): Promise<void> {
        await relationStore.load();
        this._onRelationsChanged.fire();
    }

    private async handleFileRename(event: vscode.FileRenameEvent) {
        let changed = false;
        for (const file of event.files) {
            const oldRelative = vscode.workspace.asRelativePath(file.oldUri);
            const newRelative = vscode.workspace.asRelativePath(file.newUri);

            // ★ 触发新事件（所有文件重命名）
            this._onAnyFileChange.fire({
                uri: file.newUri,
                relativePath: newRelative,
                type: 'renamed',
                oldUri: file.oldUri,
                oldRelativePath: oldRelative,
            });

            // 原有逻辑：更新关系表中的路径（只对已记录的头文件有效）
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

            // ★ 触发新事件（所有文件删除）
            this._onAnyFileChange.fire({
                uri,
                relativePath,
                type: 'deleted',
            });

            // 原有逻辑：删除关系表中的对应条目
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
        const uri = event.document.uri;
        const relativePath = vscode.workspace.asRelativePath(uri);
        // ---- 以下为原有逻辑（仅对 c/cpp 且已记录的文件生效） ----
        if (event.document.languageId !== 'c' && event.document.languageId !== 'cpp') return;
        // ★ 无条件触发新事件（所有文件内容变化，不限于 c/cpp）
        this._onAnyFileChange.fire({
            uri,
            relativePath,
            type: 'changed',
        });

        const tracked = relationStore.getAllTrackedFiles();
        if (!tracked.includes(relativePath)) return;

        // 触发关系表刷新（让界面更新）
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
         isInterface: boolean = false
    ): Promise<void> {
        relationStore.setClass(className, relativePath, parentName, hasVtable, isInterface);
        await relationStore.save();
        setTimeout(() => this._onRelationsChanged.fire(), 0);
    }
}

export const syncService = new ClassSyncService();