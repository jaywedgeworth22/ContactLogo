package com.contactlogo

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import com.contactlogo.engine.ContactsRepository
import com.contactlogo.ui.ContactLogoApp
import com.contactlogo.ui.ContactLogoViewModel
import com.contactlogo.ui.theme.ContactLogoTheme

class MainActivity : ComponentActivity() {

    private lateinit var viewModel: ContactLogoViewModel

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val readGranted = permissions[Manifest.permission.READ_CONTACTS] ?: false
        if (readGranted) {
            viewModel.scanContacts()
        }
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

        viewModel = ViewModelProvider(
            this,
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T {
                    return ContactLogoViewModel(repository) as T
                }
            }
        )[ContactLogoViewModel::class.java]

        checkAndRequestPermissions()

        setContent {
            ContactLogoTheme {
                ContactLogoApp(viewModel)
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
}
