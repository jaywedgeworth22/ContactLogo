package com.contactlogo

import android.app.Application
import io.sentry.android.core.SentryAndroid

/**
 * Early Sentry boot.  Contacts PII must not leave the device via screenshots
 * or view-hierarchy dumps, so those attachments stay off.
 */
class ContactLogoApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val dsn = BuildConfig.SENTRY_DSN
        if (dsn.isBlank()) return
        SentryAndroid.init(this) { options ->
            options.dsn = dsn
            options.isSendDefaultPii = false
            options.isAttachScreenshot = false
            options.isAttachViewHierarchy = false
            options.tracesSampleRate = 0.2
            options.isAnrEnabled = true
        }
    }
}
