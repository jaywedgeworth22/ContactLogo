package com.contactlogo.engine

/**
 * Where a mark is drawn inside the square contact photo.
 *
 * ENGINE-CONTRACT R11.7: every engine draws into a content box inset by
 * [PADDING_FRACTION] on each edge, so Contacts' circular crop never clips the
 * mark.  Android used to scale against the full canvas, which is a no-op for a
 * square source — and every Simple Icons mark is square — so the written photo
 * reached all four edges while the Compose preview, which insets, looked right.
 *
 * Deliberately free of Android types: `ContactsRepository` cannot be loaded by
 * the JVM unit suite, and this is the part worth asserting.
 */
object PhotoGeometry {
    /** Output edge length. Matches `ImagePreparer.outputSize` and web's 512. */
    const val SIZE_PX = 512

    /**
     * Matches `ImagePreparer.paddingFraction` (Swift) and `padAndSquareImage`'s
     * `paddingFraction` default (web).  All three must move together.
     */
    const val PADDING_FRACTION = 0.15f

    /** Size and top-left of the mark on a [size]×[size] canvas. */
    data class Placement(val width: Int, val height: Int, val left: Int, val top: Int)

    /** Null when the source has no usable dimensions. */
    fun place(sourceWidth: Int, sourceHeight: Int, size: Int = SIZE_PX): Placement? {
        if (sourceWidth <= 0 || sourceHeight <= 0 || size <= 0) return null
        val content = size * (1f - PADDING_FRACTION * 2f)
        val scale = minOf(content / sourceWidth, content / sourceHeight)
        val width = maxOf(1, (sourceWidth * scale).toInt())
        val height = maxOf(1, (sourceHeight * scale).toInt())
        return Placement(width, height, (size - width) / 2, (size - height) / 2)
    }
}
