import * as vscode from 'vscode';
import { CreateSubclassPanel } from '../panels/CreateSubclassPanel';

export async function createSubclass(context: vscode.ExtensionContext, headerUri: vscode.Uri) {
    const parentName = headerUri.path.split('/').pop()?.replace('.h', '') || 'Unknown';
    const defaultDir = vscode.Uri.joinPath(headerUri, '..');
    CreateSubclassPanel.createOrShow(context.extensionUri, defaultDir, parentName, headerUri);
}