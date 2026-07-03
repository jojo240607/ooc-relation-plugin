import * as vscode from 'vscode';
import * as ast from '../utils/astUtils';
import { AncestorMethod } from '../commands/overrideMethods';

export class OverrideMethodPanel {
    public static currentPanel: OverrideMethodPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private readonly _childName: string;
    private readonly _headerUri: vscode.Uri;
    private readonly _sourceUri: vscode.Uri;
    private readonly _methods: AncestorMethod[];
    private readonly _alreadyOverridden: Set<string>;  // "methodName::parentClass"
    // 新增：覆盖成功后的回调
    private readonly _onModified?: (className: string, relativePath: string) => void;

    public static createOrShow(
        extensionUri: vscode.Uri,
        childName: string,
        headerUri: vscode.Uri,
        sourceUri: vscode.Uri,
        methods: AncestorMethod[],
        alreadyOverridden: Set<string>,
        // 新增可选参数
        onModified?: (className: string, relativePath: string) => void
    ) {
        if (OverrideMethodPanel.currentPanel) {
            OverrideMethodPanel.currentPanel.dispose();
        }
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
        const panel = vscode.window.createWebviewPanel(
            'oocOverrideMethods',
            `Override Methods in ${childName}`,
            column,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        OverrideMethodPanel.currentPanel = new OverrideMethodPanel(
            panel, extensionUri, childName, headerUri, sourceUri, methods, alreadyOverridden, onModified
        );
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        childName: string,
        headerUri: vscode.Uri,
        sourceUri: vscode.Uri,
        methods: AncestorMethod[],
        alreadyOverridden: Set<string>,
        onModified?: (className: string, relativePath: string) => void
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._childName = childName;
        this._headerUri = headerUri;
        this._sourceUri = sourceUri;
        this._methods = methods;
        this._alreadyOverridden = alreadyOverridden;
        this._onModified = onModified;   // 保存回调
        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async (msg) => {
                if (msg.command === 'override') await this._handleOverride(msg.selectedMethods);
                else if (msg.command === 'cancel') this._panel.dispose();
            },
            null,
            this._disposables
        );
    }

    dispose() {
        OverrideMethodPanel.currentPanel = undefined;
        this._panel.dispose();
        this._disposables.forEach(d => d.dispose());
    }

    private _update() {
        this._panel.webview.html = this._getHtmlContent();
    }

    private removeSelfParam(params: string, parentClassName: string): string {
        const selfPrefix = `${parentClassName} *self`;
        if (params.startsWith(selfPrefix)) {
            const rest = params.substring(selfPrefix.length).trim();
            return rest.startsWith(',') ? rest.substring(1).trim() : rest;
        }
        return params;
    }

    private async _handleOverride(selected: string[]) {
        try {
            for (const key of selected) {
                const [methodName, fromClass] = key.split('::');
                const vfunc = this._methods.find(m => m.name === methodName && m.fromClass === fromClass);
                if (!vfunc) continue;

                const extraParams = this.removeSelfParam(vfunc.params, vfunc.fromClass);
                const fullParams = extraParams
                    ? `${vfunc.fromClass} *self, ${extraParams}`
                    : `${vfunc.fromClass} *self`;

                const overrideFuncName = `override_${this._childName}_${vfunc.fromClass}_${vfunc.name}_impl`;
                let sourceDoc = await vscode.workspace.openTextDocument(this._sourceUri);

                // 1. 前向声明
                const decl = `static ${vfunc.returnType} ${overrideFuncName}(${fullParams});`;
                if (!sourceDoc.getText().includes(decl)) {
                    await ast.insertAfterIncludes(sourceDoc, decl);
                }

                // 2. 虚表赋值
                const assign = `self->${vfunc.vtablePath}->${vfunc.name} = ${overrideFuncName};`;
                sourceDoc = await vscode.workspace.openTextDocument(this._sourceUri);
                await ast.insertBeforeFunctionEnd(sourceDoc, `${this._childName}_init`, assign);

                // 3. 覆写实现
                const ret = vfunc.returnType === 'void'
                    ? ''
                    : `static ${vfunc.returnType} ret = {0}; return ret;`;
                const impl = `
static ${vfunc.returnType} ${overrideFuncName}(${fullParams}) {
    ${this._childName} *child = (${this._childName}*)self;
    /* TODO: Override implementation */
    (void)child;
    ${ret}
}
`;
                sourceDoc = await vscode.workspace.openTextDocument(this._sourceUri);
                await ast.insertAtEndOfFile(sourceDoc, impl);
            }
            // 保存文件
            const finalHeaderDoc = await vscode.workspace.openTextDocument(this._headerUri);
            await finalHeaderDoc.save();
            const finalSourceDoc = await vscode.workspace.openTextDocument(this._sourceUri);
            await finalSourceDoc.save();

            // 新增：回调通知外部（更新关系表）
            if (this._onModified) {
                const relativePath = vscode.workspace.asRelativePath(this._headerUri);
                this._onModified(this._childName, relativePath);
            }

            vscode.window.showInformationMessage(`Overridden ${selected.length} method(s) in ${this._childName}.`);
            this._panel.dispose();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to override: ${err}`);
        }
    }

    private _getHtmlContent(): string {
        const rows = this._methods.map(m => {
            const key = `${m.name}::${m.fromClass}`;
            const isOverridden = this._alreadyOverridden.has(key);
            const disabledAttr = isOverridden ? 'disabled' : '';
            const style = isOverridden ? 'color: gray; opacity: 0.6; text-decoration: line-through;' : '';
            return `
                <div class="checkbox-group" style="${style}">
                    <input type="checkbox" class="method-checkbox" value="${key}" ${disabledAttr}>
                    <label>${m.returnType} ${m.name}(${m.params})
                        <span style="color: var(--vscode-descriptionForeground);">(from ${m.fromClass}, path: ${m.vtablePath})</span>
                        ${isOverridden ? '<span style="color: red;"> [already overridden]</span>' : ''}
                    </label>
                </div>
            `;
        }).join('');

        return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Override Methods</title>
<style>
    body { font-family: var(--vscode-editor-font-family); padding: 20px; color: var(--vscode-foreground); }
    .checkbox-group { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
    .actions { display: flex; gap: 8px; margin-top: 20px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
</style></head>
<body>
    <h3>Override methods from ancestors into <em>${this._childName}</em></h3>
    <div id="method-list">${rows}</div>
    <div class="actions">
        <button id="override-btn">Override Selected</button>
        <button id="cancel-btn">Cancel</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        document.getElementById('override-btn').onclick = () => {
            const sel = [];
            document.querySelectorAll('.method-checkbox:checked').forEach(cb => sel.push(cb.value));
            vscode.postMessage({ command: 'override', selectedMethods: sel });
        };
        document.getElementById('cancel-btn').onclick = () => vscode.postMessage({ command: 'cancel' });
    </script>
</body></html>`;
    }
}