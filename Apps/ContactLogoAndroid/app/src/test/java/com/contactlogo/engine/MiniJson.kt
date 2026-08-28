package com.contactlogo.engine

/**
 * A minimal, dependency-free JSON parser for reading `fixtures/golden-corpus.json`
 * in unit tests (ENGINE-CONTRACT R14.2). Handwritten rather than pulled from a
 * library so the conformance test carries no new build-time dependency: the
 * android.jar stub used by JVM unit tests does not implement `org.json`, and this
 * repository has no other JSON dependency wired into the Android module yet.
 *
 * Supports the full JSON grammar needed here: objects, arrays, strings (with
 * standard escapes including \uXXXX), numbers, booleans and null.
 */
sealed class JsonValue {
    data class JsonObject(val entries: Map<String, JsonValue>) : JsonValue() {
        operator fun get(key: String): JsonValue? = entries[key]
        fun string(key: String): String? = (entries[key] as? JsonString)?.value
        fun obj(key: String): JsonObject = entries[key] as JsonObject
        fun array(key: String): List<JsonValue> = (entries[key] as? JsonArray)?.items ?: emptyList()
        fun bool(key: String): Boolean = (entries[key] as? JsonBool)?.value ?: false
    }
    data class JsonArray(val items: List<JsonValue>) : JsonValue()
    data class JsonString(val value: String) : JsonValue()
    data class JsonNumber(val value: Double) : JsonValue()
    data class JsonBool(val value: Boolean) : JsonValue()
    object JsonNull : JsonValue()
}

object MiniJson {

    fun parse(text: String): JsonValue {
        val parser = Parser(text)
        val value = parser.parseValue()
        parser.skipWhitespace()
        return value
    }

    private class Parser(private val s: String) {
        var pos = 0

        fun skipWhitespace() {
            while (pos < s.length && s[pos].isWhitespace()) pos++
        }

        fun parseValue(): JsonValue {
            skipWhitespace()
            return when (val c = s[pos]) {
                '{' -> parseObject()
                '[' -> parseArray()
                '"' -> JsonValue.JsonString(parseString())
                't' -> { expect("true"); JsonValue.JsonBool(true) }
                'f' -> { expect("false"); JsonValue.JsonBool(false) }
                'n' -> { expect("null"); JsonValue.JsonNull }
                else -> if (c == '-' || c.isDigit()) parseNumber() else error("Unexpected char '$c' at $pos")
            }
        }

        private fun expect(literal: String) {
            require(s.regionMatches(pos, literal, 0, literal.length)) { "Expected '$literal' at $pos" }
            pos += literal.length
        }

        private fun parseObject(): JsonValue.JsonObject {
            pos++ // '{'
            val map = LinkedHashMap<String, JsonValue>()
            skipWhitespace()
            if (pos < s.length && s[pos] == '}') {
                pos++
                return JsonValue.JsonObject(map)
            }
            while (true) {
                skipWhitespace()
                val key = parseString()
                skipWhitespace()
                require(s[pos] == ':') { "Expected ':' at $pos" }
                pos++
                val value = parseValue()
                map[key] = value
                skipWhitespace()
                when (s[pos]) {
                    ',' -> { pos++; continue }
                    '}' -> { pos++; break }
                    else -> error("Expected ',' or '}' at $pos")
                }
            }
            return JsonValue.JsonObject(map)
        }

        private fun parseArray(): JsonValue.JsonArray {
            pos++ // '['
            val list = mutableListOf<JsonValue>()
            skipWhitespace()
            if (pos < s.length && s[pos] == ']') {
                pos++
                return JsonValue.JsonArray(list)
            }
            while (true) {
                val value = parseValue()
                list.add(value)
                skipWhitespace()
                when (s[pos]) {
                    ',' -> { pos++; continue }
                    ']' -> { pos++; break }
                    else -> error("Expected ',' or ']' at $pos")
                }
            }
            return JsonValue.JsonArray(list)
        }

        private fun parseString(): String {
            require(s[pos] == '"') { "Expected '\"' at $pos" }
            pos++
            val sb = StringBuilder()
            while (true) {
                val c = s[pos]
                when {
                    c == '"' -> { pos++; break }
                    c == '\\' -> {
                        pos++
                        when (val esc = s[pos]) {
                            '"' -> { sb.append('"'); pos++ }
                            '\\' -> { sb.append('\\'); pos++ }
                            '/' -> { sb.append('/'); pos++ }
                            'b' -> { sb.append('\b'); pos++ }
                            'f' -> { sb.append('\u000C'); pos++ }
                            'n' -> { sb.append('\n'); pos++ }
                            'r' -> { sb.append('\r'); pos++ }
                            't' -> { sb.append('\t'); pos++ }
                            'u' -> {
                                pos++
                                val hex = s.substring(pos, pos + 4)
                                sb.append(hex.toInt(16).toChar())
                                pos += 4
                            }
                            else -> error("Unknown escape '\\$esc' at $pos")
                        }
                    }
                    else -> { sb.append(c); pos++ }
                }
            }
            return sb.toString()
        }

        private fun parseNumber(): JsonValue.JsonNumber {
            val start = pos
            if (s[pos] == '-') pos++
            while (pos < s.length && (s[pos].isDigit() || s[pos] == '.' || s[pos] == 'e' || s[pos] == 'E' || s[pos] == '+' || s[pos] == '-')) pos++
            return JsonValue.JsonNumber(s.substring(start, pos).toDouble())
        }
    }
}
