import * as vscode from 'vscode';
import { addMembersToClass } from '../operations/addMembersOperation';

export async function quickAddMembers(
    className: string,
    headerUri: vscode.Uri,
    members: { type: string; name: string }[]
): Promise<{ success: boolean; message: string }> {
    return await addMembersToClass(className, headerUri, members);
}