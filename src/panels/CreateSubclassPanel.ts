import * as vscode from 'vscode';
import { generateSubclassHeader } from '../templates/subclassHeader';
import { generateSubclassSource } from '../templates/subclassSource';

export class CreateSubclassPanel {
    public static currentPanel: CreateSubclassPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private readonly _parentName: string;
    private readonly _defaultTargetDir: vscode.Uri;
    // 新增：创建成功后的回调
    private readonly _onSubclassCreated?: (
        className: string,
        relativePath: string,
        parentName: string | null,
        hasVtable: boolean
    ) => void;

    public static createOrShow(
        extensionUri: vscode.Uri,
        defaultTargetDir: vscode.Uri,
        parentName: string,
        // 新增可选回调
        onSubclassCreated?: (className: string, relativePath: string, parentName: string | null, hasVtable: boolean) => void
    ) {
        if (CreateSubclassPanel.currentPanel) {
            CreateSubclassPanel.currentPanel.dispose();
        }
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        const panel = vscode.window.createWebviewPanel(
            'oocCreateSubclass',
            `Subclass of ${parentName}`,
            column || vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        CreateSubclassPanel.currentPanel = new CreateSubclassPanel(
            panel, extensionUri, defaultTargetDir, parentName, onSubclassCreated
        );
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        defaultTargetDir: vscode.Uri,
        parentName: string,
        onSubclassCreated?: (className: string, relativePath: string, parentName: string | null, hasVtable: boolean) => void
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._defaultTargetDir = defaultTargetDir;
        this._parentName = parentName;
        this._onSubclassCreated = onSubclassCreated; // 保存回调

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'create':
                        await this._handleCreate(message.childName, message.targetDir);
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
        CreateSubclassPanel.currentPanel = undefined;
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

    private async _handleCreate(childName: string, targetDirStr: string) {
        try {
            const targetDir = vscode.Uri.file(targetDirStr);
            try { await vscode.workspace.fs.createDirectory(targetDir); } catch {}

            const headerContent = generateSubclassHeader(childName, this._parentName);
            const sourceContent = generateSubclassSource(childName, this._parentName);

            const headerUri = vscode.Uri.joinPath(targetDir, `${childName}.h`);
            const sourceUri = vscode.Uri.joinPath(targetDir, `${childName}.c`);

            if ((await exists(headerUri)) || (await exists(sourceUri))) {
                const overwrite = await vscode.window.showWarningMessage(
                    `File(s) for subclass "${childName}" already exist. Overwrite?`,
                    { modal: true },
                    'Yes'
                );
                if (overwrite !== 'Yes') return;
            }

            await vscode.workspace.fs.writeFile(headerUri, Buffer.from(headerContent));
            await vscode.workspace.fs.writeFile(sourceUri, Buffer.from(sourceContent));
            const doc = await vscode.workspace.openTextDocument(headerUri);
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage(`Subclass "${childName}" extending "${this._parentName}" created.`);

            // ===== 新增：回调通知外部同步缓存 =====
            const relativePath = vscode.workspace.asRelativePath(headerUri);
            // 子类：父类为 this._parentName，初始 hasVtable = false
            this._onSubclassCreated?.(childName, relativePath, this._parentName, false);

            this._panel.dispose();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to create subclass: ${err}`);
        }
    }

    private _getHtmlContent(): string {
        const defaultPath = this._defaultTargetDir.fsPath;
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create OOC Subclass</title>
    <style>
        body { font-family: var(--vscode-editor-font-family); padding: 20px; color: var(--vscode-foreground); }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        .dir-row { display: flex; gap: 8px; align-items: stretch; }
        .dir-row input { flex: 1; padding: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
        button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; white-space: nowrap; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        .actions { display: flex; gap: 8px; margin-top: 20px; }
        .info { margin-bottom: 12px; font-size: 14px; }
    </style>
</head>
<body>
    <h3>Create OOC Subclass</h3>
    <div class="info">
        <strong>Parent class:</strong> ${this._parentName}
    </div>
    <div class="form-group">
        <label for="child-name">Subclass Name:</label>
        <input type="text" id="child-name" placeholder="e.g. Car" autofocus>
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
            const child = document.getElementById('child-name').value.trim();
            const targetDir = document.getElementById('target-dir').value.trim();
            if (!child) { alert('Please enter a subclass name.'); return; }
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(child)) { alert('Invalid C identifier.'); return; }
            if (!targetDir) { alert('Please specify a target directory.'); return; }
            vscode.postMessage({ command: 'create', childName: child, targetDir: targetDir });
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