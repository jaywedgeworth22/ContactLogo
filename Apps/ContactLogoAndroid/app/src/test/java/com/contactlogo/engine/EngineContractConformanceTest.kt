package com.contactlogo.engine

import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * ENGINE-CONTRACT R14.2: loads `fixtures/golden-corpus.json` and runs the
 * static path ([MatchPipeline.evaluate]) for every case, asserting class,
 * query, domain, via, maxConfidence and the complete flag set (compared as a
 * set, per R14.1). `simpleIconsSlug` is asserted when the case carries it (R13).
 *
 * R14.3: a case this engine cannot yet satisfy must fail loudly here, never be
 * skipped or deleted. No network, no image fetch, no clock (R14.1).
 */
class EngineContractConformanceTest {

    @Test
    fun goldenCorpusConformance() {
        val root = MiniJson.parse(findGoldenCorpus().readText()) as JsonValue.JsonObject
        val cases = root.array("cases")
        assertTrue("expected the golden corpus to contain cases", cases.isNotEmpty())

        val failures = mutableListOf<String>()

        for (caseValue in cases) {
            val case = caseValue as JsonValue.JsonObject
            val id = case.string("id") ?: "<unnamed case>"
            val contact = toContact(case.obj("contact"))
            val expect = case.obj("expect")

            val result = MatchPipeline.evaluate(contact)

            val mismatches = mutableListOf<String>()

            val expectedClass = expect.string("class")
            val actualClass = when (result.contactClass) {
                ContactClass.PERSON -> "person"
                ContactClass.BUSINESS_CARD -> "businessCard"
                ContactClass.NON_BRAND -> "nonBrand"
            }
            if (actualClass != expectedClass) {
                mismatches.add("class: got $actualClass want $expectedClass")
            }

            val expectedQuery = expect.string("query")
            if (result.query != expectedQuery) {
                mismatches.add("query: got ${result.query} want $expectedQuery")
            }

            val expectedDomain = expect.string("domain")
            if (result.domain != expectedDomain) {
                mismatches.add("domain: got ${result.domain} want $expectedDomain")
            }

            val expectedVia = expect.string("via")
            if (result.via != expectedVia) {
                mismatches.add("via: got ${result.via} want $expectedVia")
            }

            val expectedConfidence = expect.string("maxConfidence")
            val actualConfidence = result.maxConfidence.name.lowercase()
            if (actualConfidence != expectedConfidence) {
                mismatches.add("maxConfidence: got $actualConfidence want $expectedConfidence")
            }

            val expectedFlags = expect.array("flags").map { (it as JsonValue.JsonString).value }.toSet()
            if (result.flags != expectedFlags) {
                mismatches.add("flags: got ${result.flags.sorted()} want ${expectedFlags.sorted()}")
            }

            val expectedSlugEntry = expect["simpleIconsSlug"]
            if (expectedSlugEntry != null) {
                val expectedSlug = (expectedSlugEntry as? JsonValue.JsonString)?.value
                val actualSlug = SimpleIcons.slugFor(result.domain)
                if (actualSlug != expectedSlug) {
                    mismatches.add("simpleIconsSlug: got $actualSlug want $expectedSlug")
                }
            }

            if (mismatches.isNotEmpty()) {
                failures.add("$id:\n    " + mismatches.joinToString("\n    "))
            }
        }

        if (failures.isNotEmpty()) {
            fail(
                "${failures.size}/${cases.size} golden-corpus cases failed:\n\n" +
                    failures.joinToString("\n\n")
            )
        }
    }

    private fun toContact(c: JsonValue.JsonObject): ContactIdentity {
        return ContactIdentity(
            id = "corpus",
            displayName = c.string("displayName") ?: "",
            givenName = c.string("givenName") ?: "",
            familyName = c.string("familyName") ?: "",
            organization = c.string("organization") ?: "",
            phoneNumbers = c.array("phones").map { (it as JsonValue.JsonString).value },
            emailAddresses = c.array("emails").map { (it as JsonValue.JsonString).value },
            urls = c.array("websites").map { (it as JsonValue.JsonString).value },
            hasCustomPhoto = c.bool("hasImage")
        )
    }

    /** Walks upward from the working directory to find the repo-root fixture. */
    private fun findGoldenCorpus(): File {
        var dir: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        var hops = 0
        while (dir != null && hops < 12) {
            val candidate = File(dir, "fixtures/golden-corpus.json")
            if (candidate.isFile) return candidate
            dir = dir.parentFile
            hops++
        }
        fail("Could not locate fixtures/golden-corpus.json above ${System.getProperty("user.dir")}")
        error("unreachable")
    }
}
