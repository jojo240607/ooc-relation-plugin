import * as vscode from 'vscode';
import { addVirtualMethods } from '../operations/addVirtualMethodOperation';
import * as ast from '../utils/astUtils';

interface AncestorVirtualMethod {
    returnType: string;
    name: string;
    params: string;
    fromClass: string;
}

export class AddMethodPanel {
    public static currentPanel: AddMethodPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private readonly _className: string;
    private readonly _headerUri: vscode.Uri;
    private readonly _sourceUri: vscode.Uri;
    private readonly _inheritedMethods: AncestorVirtualMethod[];
    private readonly _currentMethods: { returnType: string; name: string; params: string }[];
    private readonly _onModified?: (className: string, relativePath: string, parentName: string | null, hasVtable: boolean) => void;

    public static createOrShow(
        extensionUri: vscode.Uri,
        className: string,
        headerUri: vscode.Uri,
        sourceUri: vscode.Uri,
        inheritedMethods: AncestorVirtualMethod[],
        currentMethods: { returnType: string; name: string; params: string }[],
        onModified?: (className: string, relativePath: string, parentName: string | null, hasVtable: boolean) => void
    ) {
        if (AddMethodPanel.currentPanel) {
            AddMethodPanel.currentPanel.dispose();
        }
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        const panel = vscode.window.createWebviewPanel(
            'oocAddMethod',
            `Add Methods to ${className}`,
            column || vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        AddMethodPanel.currentPanel = new AddMethodPanel(
            panel, extensionUri, className, headerUri, sourceUri, inheritedMethods, currentMethods, onModified
        );
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        className: string,
        headerUri: vscode.Uri,
        sourceUri: vscode.Uri,
        inheritedMethods: AncestorVirtualMethod[],
        currentMethods: { returnType: string; name: string; params: string }[],
        onModified?: (className: string, relativePath: string, parentName: string | null, hasVtable: boolean) => void
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._className = className;
        this._headerUri = headerUri;
        this._sourceUri = sourceUri;
        this._inheritedMethods = inheritedMethods;
        this._currentMethods = currentMethods;
        this._onModified = onModified;

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                if (message.command === 'addMethods') {
                    await this._handleAddMethods(message.methods);
                } else if (message.command === 'cancel') {
                    this._panel.dispose();
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        AddMethodPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlContent();
    }

    private async _handleAddMethods(methods: { returnType: string; name: string; params: string }[]) {
        try {
            // 重名检查
            const allExistingNames = [
                ...this._inheritedMethods.map(m => m.name),
                ...this._currentMethods.map(m => m.name)
            ];
            for (const m of methods) {
                if (allExistingNames.includes(m.name)) {
                    vscode.window.showErrorMessage(`Method "${m.name}" already exists.`);
                    return;
                }
            }

            // 调用统一操作函数
            const result = await addVirtualMethods(this._className, this._headerUri, methods);
            if (!result.success) {
                vscode.window.showErrorMessage(result.message);
                return;
            }

            // 回调通知外部（用于更新视图等）
            if (this._onModified) {
                // 获取父类和虚表状态（操作后虚表一定存在）
                const headerDoc = await vscode.workspace.openTextDocument(this._headerUri);
                const structInfo = ast.findStruct(headerDoc, this._className);
                const parentName = structInfo ? ast.getParentClassName(structInfo, headerDoc) : null;
                const relativePath = vscode.workspace.asRelativePath(this._headerUri);
                this._onModified(this._className, relativePath, parentName, true);
            }

            vscode.window.showInformationMessage(result.message);
            this._panel.dispose();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to add methods: ${err}`);
        }
    }

    private _getHtmlContent(): string {
        const inheritedRows = this._inheritedMethods.length > 0
            ? this._inheritedMethods.map(m => `
                <tr>
                    <td>${m.returnType}</td>
                    <td>${m.name}</td>
                    <td>${m.params}</td>
                    <td>${m.fromClass}</td>
                </tr>`).join('')
            : '<tr><td colspan="4">No inherited virtual methods</td></tr>';

        const currentRows = this._currentMethods.length > 0
            ? this._currentMethods.map(m => `
                <tr>
                    <td>${m.returnType}</td>
                    <td>${m.name}</td>
                    <td>${m.params}</td>
                </tr>`).join('')
            : '<tr><td colspan="3">No existing virtual methods</td></tr>';

        // 将所有已存在的方法名传入前端，用于重名检查
        const existingNames = JSON.stringify([
            ...this._inheritedMethods.map(m => m.name),
            ...this._currentMethods.map(m => m.name)
        ]);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Add Methods</title>
    <style>
        body { font-family: var(--vscode-editor-font-family); padding: 15px; color: var(--vscode-foreground); }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { text-align: left; padding: 6px; border-bottom: 1px solid var(--vscode-input-border); }
        .method-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
        input { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px; }
        button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        .actions { display: flex; gap: 8px; margin-top: 15px; }
        .remove-btn { flex: none; width: 24px; text-align: center; }
        .error { color: red; font-size: 12px; }
    </style>
</head>
<body>
    <h3>Add Methods for class <em>${this._className}</em></h3>

    <h4>Inherited Virtual Methods</h4>
    <table>
        <thead><tr><th>Return</th><th>Name</th><th>Params</th><th>From</th></tr></thead>
        <tbody>${inheritedRows}</tbody>
    </table>

    <h4>Current Virtual Methods</h4>
    <table>
        <thead><tr><th>Return</th><th>Name</th><th>Params</th></tr></thead>
        <tbody>${currentRows}</tbody>
    </table>

    <h4>New Virtual Methods</h4>
    <div id="method-list"></div>
    <div class="actions">
        <button id="add-row-btn">+ Add Method</button>
        <button id="submit-btn">Submit All</button>
        <button id="cancel-btn">Cancel</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const existingNames = new Set(${existingNames});

        function createRow() {
            const row = document.createElement('div');
            row.className = 'method-row';
            row.innerHTML = \`
                <input type="text" class="return-type" placeholder="void" value="void">
                <input type="text" class="method-name" placeholder="methodName" required>
                <input type="text" class="params" placeholder="e.g., int speed">
                <button class="remove-btn" onclick="this.parentElement.remove()">✕</button>
                <span class="error" style="display:none;">Name already exists</span>
            \`;
            // 实时检查重名
            const nameInput = row.querySelector('.method-name');
            const errorSpan = row.querySelector('.error');
            nameInput.addEventListener('input', () => {
                if (existingNames.has(nameInput.value.trim())) {
                    errorSpan.style.display = 'inline';
                } else {
                    errorSpan.style.display = 'none';
                }
            });
            document.getElementById('method-list').appendChild(row);
        }

        createRow();
        document.getElementById('add-row-btn').addEventListener('click', createRow);

        document.getElementById('submit-btn').addEventListener('click', () => {
            const rows = document.querySelectorAll('.method-row');
            const methods = [];
            for (const row of rows) {
                const returnType = row.querySelector('.return-type').value.trim() || 'void';
                const name = row.querySelector('.method-name').value.trim();
                const params = row.querySelector('.params').value.trim();
                if (!name) { alert('Method name is required.'); return; }
                if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) { alert('Invalid method name: ' + name); return; }
                if (existingNames.has(name)) {
                    alert('Method "' + name + '" already exists. Please choose a different name.');
                    return;
                }
                methods.push({ returnType, name, params });
            }
            if (methods.length === 0) { alert('Please add at least one method.'); return; }
            vscode.postMessage({ command: 'addMethods', methods });
        });

        document.getElementById('cancel-btn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });
    </script>
</body>
</html>`;
    }
}