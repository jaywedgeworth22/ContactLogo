import Foundation

/// Offline name → domain table ported from `vendor/crest/src/lib/contacts.ts`.
/// Used when a contact has no usable website or work email. Homonyms still
/// go through the review-first confidence cap (MATCHING-ENGINE §4).
public enum CompanyCatalog {

    /// Lowercased, punctuation-stripped keys → registrable domain.
    static let domains: [String: String] = [
        "apple": "apple.com", "apple inc": "apple.com",
        "google": "google.com", "alphabet": "abc.xyz",
        "microsoft": "microsoft.com", "amazon": "amazon.com",
        "meta": "meta.com", "facebook": "facebook.com", "instagram": "instagram.com",
        "tesla": "tesla.com", "nvidia": "nvidia.com",
        "netflix": "netflix.com", "spotify": "spotify.com",
        "adobe": "adobe.com", "salesforce": "salesforce.com",
        "oracle": "oracle.com", "ibm": "ibm.com", "intel": "intel.com",
        "cisco": "cisco.com", "stripe": "stripe.com", "paypal": "paypal.com",
        "visa": "visa.com", "mastercard": "mastercard.com",
        "american express": "americanexpress.com", "amex": "americanexpress.com",
        "chase": "chase.com", "jpmorgan": "jpmorganchase.com",
        "jp morgan": "jpmorganchase.com", "jpmorgan chase": "jpmorganchase.com",
        "bank of america": "bankofamerica.com",
        "wells fargo": "wellsfargo.com",
        "citi": "citi.com", "citibank": "citi.com", "citigroup": "citi.com",
        "geico": "geico.com",
        "state farm": "statefarm.com", "state farm insurance": "statefarm.com",
        "allstate": "allstate.com", "allstate insurance": "allstate.com",
        "usaa": "usaa.com", "usaa insurance": "usaa.com",
        "verizon": "verizon.com",
        "at&t": "att.com", "att": "att.com",
        "t-mobile": "t-mobile.com", "tmobile": "t-mobile.com",
        "united airlines": "united.com", "united": "united.com",
        "american airlines": "aa.com",
        "delta": "delta.com", "delta air lines": "delta.com", "delta airlines": "delta.com",
        "southwest": "southwest.com", "southwest airlines": "southwest.com",
        "jetblue": "jetblue.com", "alaska airlines": "alaskaair.com",
        "fedex": "fedex.com", "ups": "ups.com", "usps": "usps.com",
        "the home depot": "homedepot.com", "home depot": "homedepot.com",
        "lowes": "lowes.com", "lowe's": "lowes.com",
        "costco": "costco.com", "walmart": "walmart.com", "target": "target.com",
        "starbucks": "starbucks.com",
        "mcdonalds": "mcdonalds.com", "mcdonald's": "mcdonalds.com",
        "uber": "uber.com", "lyft": "lyft.com", "doordash": "doordash.com",
        "airbnb": "airbnb.com", "nike": "nike.com",
        "samsung": "samsung.com", "sony": "sony.com",
        "ford": "ford.com", "bmw": "bmw.com",
        "centerpoint energy": "centerpointenergy.com", "centerpoint": "centerpointenergy.com",
        "x ai": "x.ai", "xai": "x.ai",
        "square": "squareup.com",
        "capital one": "capitalone.com", "discover": "discover.com",
        "intuit": "intuit.com", "turbotax": "turbotax.intuit.com",
        "quickbooks": "quickbooks.intuit.com",
        "h&r": "hrblock.com", "h&r block": "hrblock.com", "h and r block": "hrblock.com",
        "edward jones": "edwardjones.com",
        "charles schwab": "schwab.com", "td ameritrade": "tdameritrade.com",
        "etrade": "etrade.com", "robinhood": "robinhood.com", "coinbase": "coinbase.com",
        "american tower": "americantower.com", "crown castle": "crowncastle.com",
        "waste management": "wm.com",
        "republic": "republicservices.com", "republic services": "republicservices.com",
        "waste connections": "wasteconnections.com",
        "texas instruments": "ti.com", "qualcomm": "qualcomm.com",
        "broadcom": "broadcom.com", "amd": "amd.com",
        "advanced micro devices": "amd.com",
        "palantir": "palantir.com", "snowflake": "snowflake.com",
        "databricks": "databricks.com", "servicenow": "servicenow.com",
        "workday": "workday.com", "autodesk": "autodesk.com",
        "electronic arts": "ea.com", "activision": "activision.com",
        "take-two": "take2games.com", "roblox": "roblox.com", "unity": "unity.com",
        "epic games": "epicgames.com", "valve": "valvesoftware.com",
        "steam": "steampowered.com",
        "comcast": "xfinity.com", "xfinity": "xfinity.com", "spectrum": "spectrum.com",
        "progressive": "progressive.com", "liberty mutual": "libertymutual.com",
        "farmers": "farmers.com", "nationwide": "nationwide.com",
        "heb": "heb.com", "h-e-b": "heb.com",
        "kroger": "kroger.com", "randalls": "randalls.com", "safeway": "safeway.com",
        "publix": "publix.com", "walgreens": "walgreens.com", "cvs": "cvs.com",
        "best buy": "bestbuy.com", "macy's": "macys.com", "macys": "macys.com",
        "hertz": "hertz.com", "enterprise": "enterprise.com", "avis": "avis.com",
        "hilton": "hilton.com", "marriott": "marriott.com", "hyatt": "hyatt.com",
        "fidelity": "fidelity.com", "vanguard": "vanguard.com", "schwab": "schwab.com",
        "trader joes": "traderjoes.com", "trader joe's": "traderjoes.com",
        "aldi": "aldi.us", "whole foods": "wholefoodsmarket.com", "whole foods market": "wholefoodsmarket.com",
        "kaiser": "kp.org", "kaiser permanente": "kp.org", "quest": "questdiagnostics.com", "quest diagnostics": "questdiagnostics.com",
        "labcorp": "labcorp.com", "enterprise rent-a-car": "enterprise.com",
        "shell": "shell.com", "chevron": "chevron.com",
        "exxon": "exxon.com", "exxonmobil": "exxonmobil.com", "bp": "bp.com", "7 eleven": "7-eleven.com", "7-eleven": "7-eleven.com",
        "wawa": "wawa.com", "bucees": "buc-ees.com", "buc ees": "buc-ees.com", "buc-ees": "buc-ees.com",
        "reliant": "reliant.com", "pg&e": "pge.com",
        "duke energy": "duke-energy.com", "amtrak": "amtrak.com",
        "txt": "texasbytexas.com", "texas by texas": "texasbytexas.com",
        "gcx": "raise.com", "raise": "raise.com"
    ]

    /// R8.3 `CATALOG_TAIL_OK` — a location or sub-brand tail after a known
    /// brand ("Walgreens Mason Rd", "H-E-B Pharmacy").  Trade words such as
    /// "dental" are deliberately absent, so "Delta Dental" never reduces to
    /// delta.com.
    static func isAllowedTail(_ tail: String) -> Bool {
        WordLists.isCatalogTailOK(tail)
    }

    public static func domain(forName raw: String) -> String? {
        let key = NameNormalizer.companyKey(raw)
        guard !key.isEmpty else { return nil }
        if let d = domains[key] { return d }
        let nospace = key.replacingOccurrences(of: " ", with: "")
        if let d = domains[nospace] { return d }

        let words = key.split(separator: " ").map(String.init).filter { !$0.isEmpty }
        guard words.count >= 2 else { return nil }
        for i in stride(from: words.count - 1, through: 1, by: -1) {
            let head = words[..<i].joined(separator: " ")
            let tail = words[i...].joined(separator: " ")
            let hit = domains[head] ?? domains[head.replacingOccurrences(of: " ", with: "")]
            if let hit, isAllowedTail(tail) {
                return hit
            }
        }
        return nil
    }
}
