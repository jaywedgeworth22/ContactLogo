package com.contactlogo.ui

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable

@Composable
fun PlayUpdateDialog(
    visible: Boolean,
    onUpdate: () -> Unit,
    onNotNow: () -> Unit,
) {
    if (!visible) return
    AlertDialog(
        onDismissRequest = onNotNow,
        title = { Text("Update Available") },
        text = {
            Text("A newer version of ContactLogo is available.\u00A0 You can update now or keep this version.")
        },
        confirmButton = {
            TextButton(onClick = onUpdate) { Text("Update") }
        },
        dismissButton = {
            TextButton(onClick = onNotNow) { Text("Not Now") }
        },
    )
}
