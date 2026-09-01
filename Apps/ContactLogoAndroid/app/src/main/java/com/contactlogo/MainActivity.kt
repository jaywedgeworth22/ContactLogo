package com.contactlogo

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.contactlogo.engine.ContactsRepository
import com.contactlogo.engine.UndoLog
import com.contactlogo.ui.ContactLogoApp
import com.contactlogo.ui.ContactLogoViewModel
import com.contactlogo.ui.PlayUpdateDialog
import com.contactlogo.ui.theme.ContactLogoTheme
import java.io.File
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability

class MainActivity : ComponentActivity() {

    private lateinit var viewModel: ContactLogoViewModel
    private var appUpdateManager: AppUpdateManager? = null
    private var pendingUpdateInfo: AppUpdateInfo? = null
    private var showPlayUpdate by mutableStateOf(false)
    private var playUpdateDismissed = false

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val readGranted = permissions[Manifest.permission.READ_CONTACTS] ?: false
        if (readGranted) {
            viewModel.scanContacts()
        }
    }

    private val playUpdateLauncher = registerForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult()
    ) {
        // Flexible Play updates are skippable.  Any result is silent.
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // targetSdk 35 (Android 15) forces edge-to-edge for every app regardless
        // of what the manifest theme says (CL-24): the old
        // statusBarColor/navigationBarColor theme overrides are ignored under
        // that enforcement. enableEdgeToEdge() replaces them with the
        // version-aware system-bar styling Compose's Scaffold already expects
        // (it pads content by WindowInsets.safeDrawing), and behaves correctly
        // on every API level back to minSdk 26, not just 35+.
        enableEdgeToEdge()
        val repository = ContactsRepository(applicationContext)
        // Prior PHOTO bytes stay off backup/Drive even if allowBackup is flipped later.
        val undoLog = UndoLog(File(applicationContext.noBackupFilesDir, "undo"))

        viewModel = ViewModelProvider(
            this,
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return ContactLogoViewModel(repository, undoLog) as T
                }
            }
        )[ContactLogoViewModel::class.java]

        checkAndRequestPermissions()
        checkPlayUpdate()

        setContent {
            ContactLogoTheme {
                Box(Modifier.fillMaxSize()) {
                    ContactLogoApp(viewModel)
                    PlayUpdateDialog(
                        visible = showPlayUpdate,
                        onUpdate = { startFlexibleUpdate() },
                        onNotNow = { dismissPlayUpdate() },
                    )
                }
            }
        }
    }

    private fun checkAndRequestPermissions() {
        val read = ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS)
        val write = ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_CONTACTS)

        if (read == PackageManager.PERMISSION_GRANTED && write == PackageManager.PERMISSION_GRANTED) {
            viewModel.scanContacts()
        } else {
            requestPermissionLauncher.launch(
                arrayOf(
                    Manifest.permission.READ_CONTACTS,
                    Manifest.permission.WRITE_CONTACTS
                )
            )
        }
    }

    private fun checkPlayUpdate() {
        try {
            val manager = AppUpdateManagerFactory.create(this)
            appUpdateManager = manager
            manager.appUpdateInfo
                .addOnSuccessListener { info ->
                    val available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                    val flexible = info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)
                    if (PlayAppUpdate.shouldOffer(available, flexible, playUpdateDismissed)) {
                        pendingUpdateInfo = info
                        showPlayUpdate = true
                    }
                }
                .addOnFailureListener {
                    // Fail silent when Play is missing, sideloaded, or offline.
                }
        } catch (_: Exception) {
            // Fail silent.
        }
    }

    private fun startFlexibleUpdate() {
        val manager = appUpdateManager
        val info = pendingUpdateInfo
        showPlayUpdate = false
        if (manager == null || info == null) return
        try {
            manager.startUpdateFlowForResult(
                info,
                playUpdateLauncher,
                AppUpdateOptions.newBuilder(AppUpdateType.FLEXIBLE).build(),
            )
        } catch (_: Exception) {
            // Fail silent.
        }
    }

    private fun dismissPlayUpdate() {
        playUpdateDismissed = true
        showPlayUpdate = false
        pendingUpdateInfo = null
    }
}
