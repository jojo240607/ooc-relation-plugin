import * as vscode from 'vscode';
import { CreateClassPanel } from '../panels/CreateClassPanel';
import { syncService } from '../sync/ClassSyncService';

export async function createClass(context: vscode.ExtensionContext, folderUri?: vscode.Uri) {
    let defaultDir = folderUri || vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!defaultDir) {
        vscode.window.showErrorMessage('No folder selected.');
        return;
    }
    // 如果右键的是文件，取其父目录
    try {
        const stat = await vscode.workspace.fs.stat(defaultDir);
        if (stat.type !== vscode.FileType.Directory) {
            defaultDir = vscode.Uri.joinPath(defaultDir, '..');
        }
    } catch {
        // 忽略
    }
    CreateClassPanel.createOrShow(
        context.extensionUri,
        defaultDir,
        (className, relativePath, parentName, hasVtable) => {
            syncService.registerClass(className, relativePath, parentName, hasVtable);
        }
    );
}