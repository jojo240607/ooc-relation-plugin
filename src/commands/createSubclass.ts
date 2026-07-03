import * as vscode from 'vscode';
import { CreateSubclassPanel } from '../panels/CreateSubclassPanel';
import { syncService } from '../sync/ClassSyncService';

export async function createSubclass(context: vscode.ExtensionContext, headerUri: vscode.Uri) {
    const parentName = headerUri.path.split('/').pop()?.replace('.h', '') || 'Unknown';
    const defaultDir = vscode.Uri.joinPath(headerUri, '..');
    CreateSubclassPanel.createOrShow(
        context.extensionUri,
        defaultDir,
        parentName,
        // 新增回调：将新创建的子类注册到同步服务
        (childName, relativePath, parent, hasVtable) => {
            syncService.registerClass(childName, relativePath, parent, hasVtable);
        }
    );
}