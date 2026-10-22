package xyz.reddate.tv

import java.util.Locale

/** Language names and flags, read out of release names ("…1080p.Hindi.English.WEB-DL…") and track tags. */
object Langs {
    private val flags = linkedMapOf(
        "english" to "🇬🇧", "hindi" to "🇮🇳", "tamil" to "🇮🇳", "telugu" to "🇮🇳",
        "malayalam" to "🇮🇳", "kannada" to "🇮🇳", "marathi" to "🇮🇳", "punjabi" to "🇮🇳",
        "bengali" to "🇧🇩", "urdu" to "🇵🇰", "spanish" to "🇪🇸", "latino" to "🇲🇽",
        "french" to "🇫🇷", "german" to "🇩🇪", "italian" to "🇮🇹", "portuguese" to "🇵🇹",
        "brazilian" to "🇧🇷", "russian" to "🇷🇺", "japanese" to "🇯🇵", "korean" to "🇰🇷",
        "chinese" to "🇨🇳", "arabic" to "🇸🇦", "turkish" to "🇹🇷", "indonesian" to "🇮🇩",
        "vietnamese" to "🇻🇳", "thai" to "🇹🇭", "polish" to "🇵🇱", "dutch" to "🇳🇱",
        "swedish" to "🇸🇪", "greek" to "🇬🇷", "hebrew" to "🇮🇱", "persian" to "🇮🇷",
        "malay" to "🇲🇾", "filipino" to "🇵🇭", "ukrainian" to "🇺🇦", "czech" to "🇨🇿",
        "romanian" to "🇷🇴", "hungarian" to "🇭🇺"
    )
    private const val GLOBE = "🌐"

    // short forms that are safe as whole words
    private val short = mapOf("eng" to "english", "hin" to "hindi", "tam" to "tamil", "tel" to "telugu", "mal" to "malayalam", "kan" to "kannada",
        "spa" to "spanish", "fre" to "french", "fra" to "french", "ger" to "german", "deu" to "german", "ita" to "italian", "jpn" to "japanese", "kor" to "korean",
        "chi" to "chinese", "zho" to "chinese", "rus" to "russian", "por" to "portuguese", "tur" to "turkish", "ara" to "arabic", "vff" to "french", "vf" to "french",
        "castellano" to "spanish", "espanol" to "spanish", "espa" to "spanish", "francais" to "french", "deutsch" to "german", "italiano" to "italian",
        "portugues" to "portuguese", "nederlands" to "dutch", "nld" to "dutch", "nor" to "norwegian", "dan" to "danish", "fin" to "finnish", "swe" to "swedish",
        "gre" to "greek", "heb" to "hebrew", "tha" to "thai", "vie" to "vietnamese", "ind" to "indonesian", "may" to "malay", "msa" to "malay", "pol" to "polish",
        "ukr" to "ukrainian", "hun" to "hungarian", "rum" to "romanian", "ron" to "romanian", "cze" to "czech", "ces" to "czech", "bul" to "bulgarian", "hrv" to "croatian",
        "srp" to "serbian", "slk" to "slovak", "slv" to "slovenian", "ben" to "bengali", "urd" to "urdu", "mar" to "marathi", "pan" to "punjabi", "guj" to "gujarati",
        "fil" to "filipino", "tgl" to "filipino", "per" to "persian", "fas" to "persian", "lat" to "latino", "latam" to "latino", "brazilian" to "brazilian",
        "cantonese" to "cantonese", "mandarin" to "mandarin", "japanese" to "japanese", "jap" to "japanese", "kor" to "korean")

    private val wordRe = Regex("[a-z]+")
    // Two-letter codes are only trusted in brackets or between separators, in capitals: [ES] (FR) .DE.
    private val two = mapOf("EN" to "english", "ES" to "spanish", "FR" to "french", "DE" to "german", "PT" to "portuguese", "RU" to "russian", "JA" to "japanese",
        "JP" to "japanese", "KO" to "korean", "KR" to "korean", "ZH" to "chinese", "CN" to "chinese", "AR" to "arabic", "TR" to "turkish", "PL" to "polish",
        "NL" to "dutch", "SV" to "swedish", "EL" to "greek", "HE" to "hebrew", "TH" to "thai", "VI" to "vietnamese", "ID" to "indonesian", "UK" to "ukrainian",
        "CS" to "czech", "HU" to "hungarian", "RO" to "romanian", "HI" to "hindi", "TA" to "tamil", "TE" to "telugu", "ML" to "malayalam", "KN" to "kannada",
        "BN" to "bengali", "MR" to "marathi", "PA" to "punjabi", "UR" to "urdu", "FA" to "persian", "DA" to "danish", "FI" to "finnish", "NO" to "norwegian")
    private val twoRe = Regex("(?<![A-Za-z])[\\[(._-]?(EN|ES|FR|DE|PT|RU|JA|JP|KO|KR|ZH|CN|AR|TR|PL|NL|SV|EL|HE|TH|VI|ID|UK|CS|HU|RO|HI|TA|TE|ML|KN|BN|MR|PA|UR|FA|DA|FI|NO)[\\])._-](?![A-Za-z])")

    /** Language names mentioned, in order of appearance. */
    fun scan(text: String): List<String> {
        val out = LinkedHashSet<String>()
        for (m in twoRe.findAll(text)) two[m.groupValues[1]]?.let { out += it }
        // Normalise accents so "Español" and "Français" are found.
        val plain = java.text.Normalizer.normalize(text.lowercase(), java.text.Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")
        for (m in wordRe.findAll(plain)) {
            val w = m.value
            if (flags.containsKey(w)) out += w else short[w]?.let { out += it }
        }
        return out.toList()
    }

    /** Flag emoji the release name already carries (🇮🇳🇬🇧…), in order. */
    fun flagsInText(text: String): List<String> {
        val out = LinkedHashSet<String>()
        var i = 0
        while (i < text.length - 3) {
            val a = text.codePointAt(i)
            val n = Character.charCount(a)
            if (i + n < text.length) {
                val b = text.codePointAt(i + n)
                if (a in 0x1F1E6..0x1F1FF && b in 0x1F1E6..0x1F1FF) { out += String(Character.toChars(a)) + String(Character.toChars(b)); i += n + Character.charCount(b); continue }
            }
            i += n
        }
        return out.toList()
    }

    fun isMulti(text: String): Boolean { val t = text.lowercase(); return Regex("\\bmulti\\b|dual.?audio|\\bdual\\b").containsMatchIn(t) }

    fun flag(name: String): String = flags[name.lowercase()] ?: ""

    /** An ISO code from a track ("hin", "en", "es-419") to a lowercase English name, or "". */
    private val odd = mapOf("pob" to "brazilian", "pt-br" to "brazilian", "pb" to "brazilian", "ptbr" to "brazilian", "zht" to "chinese", "zhc" to "chinese", "ze" to "chinese",
        "spl" to "latino", "es-419" to "latino", "pom" to "portuguese", "scc" to "serbian", "ell" to "greek", "per" to "persian", "fas" to "persian", "cze" to "czech", "dut" to "dutch",
        "rum" to "romanian", "sat" to "santali", "ind" to "indonesian", "may" to "malay", "heb" to "hebrew", "pol" to "polish", "swe" to "swedish", "tha" to "thai", "vie" to "vietnamese",
        "ukr" to "ukrainian", "hun" to "hungarian", "ben" to "bengali", "urd" to "urdu", "mar" to "marathi", "pan" to "punjabi")
    fun nameOf(code: String?): String {
        if (code.isNullOrEmpty() || code == "und") return ""
        odd[code.lowercase()]?.let { return it }
        val n = try { Locale.forLanguageTag(code).getDisplayLanguage(Locale.ENGLISH).lowercase() } catch (_: Exception) { "" }
        return if (n.isEmpty() || n == code.lowercase()) "" else n
    }

    fun flagOfCode(code: String?): String = flag(nameOf(code))
    fun globe() = GLOBE
}
