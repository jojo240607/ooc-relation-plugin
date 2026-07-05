import * as vscode from 'vscode';
import { createClassFiles } from '../operations/createClassOperation';

export class CreateClassPanel {
    public static currentPanel: CreateClassPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private readonly _defaultTargetDir: vscode.Uri | undefined;
    // 新增：创建成功后的回调
    private readonly _onClassCreated?: (
        className: string,
        relativePath: string,
        parentName: string | null,
        hasVtable: boolean
    ) => void;

    public static createOrShow(
        extensionUri: vscode.Uri,
        defaultTargetDir?: vscode.Uri,
        // 新增可选回调
        onClassCreated?: (className: string, relativePath: string, parentName: string | null, hasVtable: boolean) => void
    ) {
        if (CreateClassPanel.currentPanel) {
            CreateClassPanel.currentPanel.dispose();
        }
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        const panel = vscode.window.createWebviewPanel(
            'oocCreateClass',
            'Create OOC Class',
            column || vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        CreateClassPanel.currentPanel = new CreateClassPanel(panel, extensionUri, defaultTargetDir, onClassCreated);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        defaultTargetDir?: vscode.Uri,
        // 新增可选回调参数
        onClassCreated?: (className: string, relativePath: string, parentName: string | null, hasVtable: boolean) => void
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._defaultTargetDir = defaultTargetDir;
        this._onClassCreated = onClassCreated; // 保存回调
        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'create':
                        await this._handleCreate(message.className, message.targetDir);
                        return;
                    case 'browse':
                        await this._handleBrowse();
                        return;
                    case 'cancel':
                        this._panel.dispose();
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        CreateClassPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlContent();
    }

    private async _handleBrowse() {
        const folderUris = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select target directory',
            defaultUri: this._defaultTargetDir
        });
        if (folderUris && folderUris.length > 0) {
            this._panel.webview.postMessage({ command: 'setDirectory', path: folderUris[0].fsPath });
        }
    }

    private async _handleCreate(className: string, targetDirStr: string) {
        try {
            const targetDir = vscode.Uri.file(targetDirStr);
            // 确保目录存在
            try { await vscode.workspace.fs.createDirectory(targetDir); } catch {}

            const result = await createClassFiles(className, targetDir);
            if (!result.success) {
                vscode.window.showErrorMessage(result.message);
                return;
            }

            // 面板特有的操作：显示成功消息并关闭
            vscode.window.showInformationMessage(`OOC class "${className}" created.`);
            this._panel.dispose();

            // 回调通知外部（例如刷新视图等）
            if (this._onClassCreated) {
                this._onClassCreated(className, result.relativePath!, null, false);
            }
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to create class: ${err}`);
        }
    }

    private _getHtmlContent(): string {
        const defaultPath = this._defaultTargetDir?.fsPath || '';
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create OOC Class</title>
    <style>
        body { font-family: var(--vscode-editor-font-family); padding: 20px; color: var(--vscode-foreground); }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        .dir-row { display: flex; gap: 8px; align-items: stretch; }
        .dir-row input { flex: 1; padding: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
        button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; white-space: nowrap; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        .actions { display: flex; gap: 8px; margin-top: 20px; }
    </style>
</head>
<body>
    <h3>Create OOC Class</h3>
    <div class="form-group">
        <label for="class-name">Class Name:</label>
        <input type="text" id="class-name" placeholder="e.g. Motor" autofocus>
    </div>
    <div class="form-group">
        <label for="target-dir">Target Directory:</label>
        <div class="dir-row">
            <input type="text" id="target-dir" value="${defaultPath}">
            <button id="browse-btn">Browse...</button>
        </div>
    </div>
    <div class="actions">
        <button id="create-btn">Create</button>
        <button id="cancel-btn">Cancel</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        document.getElementById('browse-btn').addEventListener('click', () => {
            vscode.postMessage({ command: 'browse' });
        });
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'setDirectory') {
                document.getElementById('target-dir').value = message.path;
            }
        });
        document.getElementById('create-btn').addEventListener('click', () => {
            const name = document.getElementById('class-name').value.trim();
            const targetDir = document.getElementById('target-dir').value.trim();
            if (!name) { alert('Please enter a class name.'); return; }
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) { alert('Invalid C identifier.'); return; }
            if (!targetDir) { alert('Please specify a target directory.'); return; }
            vscode.postMessage({ command: 'create', className: name, targetDir: targetDir });
        });
        document.getElementById('cancel-btn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });
    </script>
</body>
</html>`;
    }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}