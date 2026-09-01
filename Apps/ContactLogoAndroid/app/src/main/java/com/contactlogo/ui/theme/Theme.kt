package com.contactlogo.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Slate900 = Color(0xFF0F172A)
val Slate800 = Color(0xFF1E293B)
val Slate700 = Color(0xFF334155)
val Slate100 = Color(0xFFF1F5F9)
val Sky500 = Color(0xFF0EA5E9)
val Sky400 = Color(0xFF38BDF8)
val Green500 = Color(0xFF22C55E)
val Amber500 = Color(0xFFF59E0B)

private val DarkColorScheme = darkColorScheme(
    primary = Sky400,
    secondary = Green500,
    tertiary = Amber500,
    background = Color(0xFF0C0A09),
    surface = Color(0xFF1C1917),
    onPrimary = Color.Black,
    onSecondary = Color.Black,
    onBackground = Color(0xFFF2F2F7),
    onSurface = Color(0xFFF2F2F7)
)

private val LightColorScheme = lightColorScheme(
    primary = Sky500,
    secondary = Green500,
    tertiary = Amber500,
    background = Color(0xFFF8FAFC),
    surface = Color.White,
    onPrimary = Color.White,
    onSecondary = Color.White,
    onBackground = Slate900,
    onSurface = Slate900
)

@Composable
fun ContactLogoTheme(
    darkTheme: Boolean = false,
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}
