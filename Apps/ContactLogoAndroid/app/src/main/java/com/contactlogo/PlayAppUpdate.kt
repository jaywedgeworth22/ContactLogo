package com.contactlogo

object PlayAppUpdate {
    fun shouldOffer(
        updateAvailable: Boolean,
        flexibleAllowed: Boolean,
        alreadyDismissed: Boolean,
    ): Boolean {
        return updateAvailable && flexibleAllowed && !alreadyDismissed
    }
}
