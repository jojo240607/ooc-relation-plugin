import * as vscode from 'vscode';
import { createInterfaceFiles } from '../operations/createInterfaceOperation';

export class CreateInterfacePanel {
    public static currentPanel: CreateInterfacePanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private readonly _defaultTargetDir: vscode.Uri;
    // 新增：创建成功后的回调
    private readonly _onInterfaceCreated?: (
        interfaceName: string,
        relativePath: string,
        parentName: string | null,
        hasVtable: boolean
    ) => void;

    public static createOrShow(
        extensionUri: vscode.Uri,
        defaultTargetDir: vscode.Uri,
        // 新增可选回调
        onInterfaceCreated?: (interfaceName: string, relativePath: string, parentName: string | null, hasVtable: boolean) => void
    ) {
        if (CreateInterfacePanel.currentPanel) {
            CreateInterfacePanel.currentPanel.dispose();
        }
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
        const panel = vscode.window.createWebviewPanel(
            'oocCreateInterface',
            'Create OOC Interface',
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        CreateInterfacePanel.currentPanel = new CreateInterfacePanel(panel, extensionUri, defaultTargetDir, onInterfaceCreated);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        defaultTargetDir: vscode.Uri,
        onInterfaceCreated?: (interfaceName: string, relativePath: string, parentName: string | null, hasVtable: boolean) => void
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._defaultTargetDir = defaultTargetDir;
        this._onInterfaceCreated = onInterfaceCreated; // 保存回调
        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async (msg) => {
                switch (msg.command) {
                    case 'create':
                        await this._handleCreate(msg.interfaceName, msg.targetDir, msg.methods);
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
        CreateInterfacePanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) d.dispose();
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlContent();
    }

    private async _handleBrowse() {
        const folders = await vscode.window.showOpenDialog({
            canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
            openLabel: 'Select Target Directory', defaultUri: this._defaultTargetDir
        });
        if (folders && folders.length > 0) {
            this._panel.webview.postMessage({ command: 'setDirectory', path: folders[0].fsPath });
        }
    }

    private async _handleCreate(interfaceName: string, targetDirStr: string, methods: { returnType: string; name: string; params: string }[]) {
        try {
            const targetDir = vscode.Uri.file(targetDirStr);
            try { await vscode.workspace.fs.createDirectory(targetDir); } catch {}

            // 先尝试非强制创建
            let result = await createInterfaceFiles(interfaceName, targetDir, methods, false);
            // 如果文件已存在，询问用户是否覆盖
            if (!result.success && result.message.includes('already exists')) {
                const ans = await vscode.window.showWarningMessage(
                    `Files for interface "${interfaceName}" already exist. Overwrite?`,
                    { modal: true },
                    'Yes'
                );
                if (ans === 'Yes') {
                    result = await createInterfaceFiles(interfaceName, targetDir, methods, true);
                }
            }

            if (!result.success) {
                vscode.window.showErrorMessage(result.message);
                return;
            }

            vscode.window.showInformationMessage(`OOC Interface "${interfaceName}" created.`);

            // 回调通知外部（如果有）
            const relativePath = vscode.workspace.asRelativePath(vscode.Uri.joinPath(targetDir, `${interfaceName}.h`));
            const hasVtable = methods.length > 0;
            this._onInterfaceCreated?.(interfaceName, relativePath, null, hasVtable);

            this._panel.dispose();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to create interface: ${err}`);
        }
    }

    private _getHtmlContent(): string {
        const defaultPath = this._defaultTargetDir.fsPath;
        return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Create Interface</title>
<style>
    body { font-family: var(--vscode-editor-font-family); padding: 20px; color: var(--vscode-foreground); }
    .form-group { margin-bottom: 15px; }
    label { display: block; margin-bottom: 5px; font-weight: bold; }
    .dir-row { display: flex; gap: 8px; align-items: stretch; }
    .dir-row input { flex: 1; padding: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; white-space: nowrap; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .actions { display: flex; gap: 8px; margin-top: 20px; }
    .method-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
    .method-row input { flex: 1; padding: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
    .remove-btn { width: 24px; text-align: center; }
</style></head>
<body>
    <h3>Create OOC Interface</h3>
    <div class="form-group">
        <label for="name">Interface Name:</label>
        <input type="text" id="name" placeholder="e.g. IAnimal" autofocus>
    </div>
    <div class="form-group">
        <label for="target">Target Directory:</label>
        <div class="dir-row">
            <input type="text" id="target" value="${defaultPath}">
            <button id="browse-btn">Browse...</button>
        </div>
    </div>
    <div class="form-group">
        <label>Virtual Methods (optional):</label>
        <div id="method-list">
            <div class="method-row">
                <input type="text" class="ret-type" placeholder="void" value="void">
                <input type="text" class="method-name" placeholder="methodName">
                <input type="text" class="method-params" placeholder="extra params (without self)">
                <button class="remove-btn" onclick="this.parentElement.remove()">✕</button>
            </div>
        </div>
        <button id="add-method-btn" style="margin-top:5px;">+ Add Method</button>
    </div>
    <div class="actions">
        <button id="create-btn">Create</button>
        <button id="cancel-btn">Cancel</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        document.getElementById('browse-btn').onclick = () => vscode.postMessage({command:'browse'});
        window.addEventListener('message', e => {
            if (e.data.command === 'setDirectory') document.getElementById('target').value = e.data.path;
        });

        document.getElementById('add-method-btn').onclick = () => {
            const row = document.createElement('div');
            row.className = 'method-row';
            row.innerHTML = \`
                <input type="text" class="ret-type" placeholder="void" value="void">
                <input type="text" class="method-name" placeholder="methodName">
                <input type="text" class="method-params" placeholder="extra params (without self)">
                <button class="remove-btn" onclick="this.parentElement.remove()">✕</button>
            \`;
            document.getElementById('method-list').appendChild(row);
        };

        document.getElementById('create-btn').onclick = () => {
            const name = document.getElementById('name').value.trim();
            const targetDir = document.getElementById('target').value.trim();
            if (!name || !/^[A-Za-z_]\\w*$/.test(name)) return alert('Invalid interface name.');
            if (!targetDir) return alert('Select a directory.');

            const methods = [];
            document.querySelectorAll('.method-row').forEach(row => {
                const ret = row.querySelector('.ret-type').value.trim() || 'void';
                const mName = row.querySelector('.method-name').value.trim();
                const params = row.querySelector('.method-params').value.trim();
                if (mName) methods.push({ returnType: ret, name: mName, params });
            });
            vscode.postMessage({ command: 'create', interfaceName: name, targetDir, methods });
        };
        document.getElementById('cancel-btn').onclick = () => vscode.postMessage({command:'cancel'});
    </script>
</body></html>`;
    }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}