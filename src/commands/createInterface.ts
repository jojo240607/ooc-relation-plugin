import * as vscode from 'vscode';
import { CreateInterfacePanel } from '../panels/CreateInterfacePanel';
import { syncService } from '../sync/ClassSyncService';

export async function createInterface(context: vscode.ExtensionContext, folderUri?: vscode.Uri) {
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
    CreateInterfacePanel.createOrShow(
        context.extensionUri,
        defaultDir,
        // 新增回调：将新创建的接口注册到同步服务
        (interfaceName, relativePath, parentName, hasVtable) => {
            syncService.registerClass(interfaceName, relativePath, parentName, hasVtable, true);
        }
    );
}