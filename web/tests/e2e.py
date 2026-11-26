"""Ende-zu-Ende-Test der Seite in Chrome: Meine Daten, Rechnung erzeugen, Liste, Zahlung, XML-Import, Sicherung.
Aufruf: python tests/e2e.py <basis-url> <ausgabeordner>
"""
import json, sys, pathlib, re
from playwright.sync_api import sync_playwright, expect

basis, ziel = sys.argv[1], pathlib.Path(sys.argv[2])
ziel.mkdir(parents=True, exist_ok=True)
fehler = []

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=sys.argv[3] if len(sys.argv) > 3 else None)
    seite = browser.new_page(accept_downloads=True, viewport={"width": 1280, "height": 1000})
    seite.on("pageerror", lambda e: fehler.append(str(e)))
    seite.on("dialog", lambda d: d.accept())
    seite.on("console", lambda m: fehler.append(m.text) if m.type == "error" else None)
    seite.goto(basis + "/index.html")
    expect(seite.locator("#tab-profil")).to_be_visible()  # Erststart -> Meine Daten

    f = seite.locator("#form-profil")
    for name, wert in {"name": "Erika Mustermann", "strasse": "Musterweg 1", "plz": "12345", "ort": "Musterstadt",
                       "email": "rechnung@erika-mustermann.example", "telefon": "+49 123 456789",
                       "steuernummer": "12/345/67890", "iban": "DE89 3704 0044 0532 0130 00", "bic": "COBADEFFXXX",
                       "praefix": "2027-"}.items():
        f.locator(f"[name={name}]").fill(wert)
    f.locator("[name=steuerfall]").select_option("kleinunternehmer")
    f.locator("button[type=submit]").click()
    seite.screenshot(path=str(ziel / "1_meine_daten.png"), full_page=True)

    seite.click("button[data-tab=rechnung]")
    r = seite.locator("#form-rechnung")
    expect(r.locator("[name=nummer]")).to_have_value("2027-001")
    r.locator("[name=steuerfall]").select_option("kleinunternehmer")
    for name, wert in {"k.name": "Beispiel Beratung GmbH", "k.strasse": "Hauptstraße 10", "k.plz": "60311",
                       "k.ort": "Frankfurt am Main", "leistungsdatum": "2027-01-14", "kaeuferreferenz": "PO-4711"}.items():
        r.locator(f"[name='{name}']").fill(wert)
    zeile = seite.locator("#positionen .position").first
    zeile.locator("[name=bezeichnung]").fill("Workshop KI im Büroalltag")
    zeile.locator("[name=einheit]").select_option("DAY")
    zeile.locator("[name=einzelpreis]").fill("900,00")
    seite.click("#position-neu")
    z2 = seite.locator("#positionen .position").nth(1)
    z2.locator("[name=bezeichnung]").fill("Reisekostenpauschale")
    z2.locator("[name=einheit]").select_option("LS")
    z2.locator("[name=einzelpreis]").fill("85,50")
    expect(seite.locator("#summen")).to_contain_text("985,50 €")

    # 1. Versuch ohne Käufer-E-Mail -> Pflichtangabe gemeldet
    seite.click("#erstellen")
    expect(seite.locator("#pruefliste")).to_contain_text("E-Mail-Adresse für den Rechnungseingang")
    seite.screenshot(path=str(ziel / "2_pflichtangabe_fehlt.png"), full_page=True)

    r.locator("[name='k.email']").fill("eingangsrechnungen@beispiel-beratung.example")
    with seite.expect_download(timeout=60000) as dl:
        seite.click("#erstellen")
    pdf = ziel / "zugferd_browser.pdf"
    dl.value.save_as(pdf)
    expect(seite.locator("#pruefliste")).to_contain_text("alle offiziellen Prüfregeln bestanden")
    seite.screenshot(path=str(ziel / "3_erstellt.png"), full_page=True)
    expect(r.locator("[name=nummer]")).to_have_value("2027-002")

    # Nur-PDF
    r.locator("[name='k.name']").fill("Max Privat")
    r.locator("[name='k.strasse']").fill("Gartenweg 2"); r.locator("[name='k.plz']").fill("70173"); r.locator("[name='k.ort']").fill("Stuttgart")
    r.locator("[name='k.email']").fill("")
    r.locator("[name=leistungsdatum]").fill("2027-01-20")
    seite.locator("#positionen .position").first.locator("[name=bezeichnung]").fill("Einzelcoaching")
    seite.locator("#positionen .position").first.locator("[name=einzelpreis]").fill("120")
    seite.locator("label.wahl:has(input[value=pdf])").click()
    try:
        with seite.expect_download(timeout=30000) as dl2:
            seite.click("#erstellen")
        dl2.value.save_as(ziel / "nurpdf_browser.pdf")
    except Exception:
        seite.screenshot(path=str(ziel / "fehler_nurpdf.png"), full_page=True)
        print("Prüfliste:", seite.locator("#pruefliste").inner_text())
        raise

    # Liste, Zahlung
    seite.click("button[data-tab=liste]")
    expect(seite.locator("#tabelle-rechnungen tbody tr")).to_have_count(2)
    seite.locator("#tabelle-rechnungen tr", has_text="2027-001").locator("button[data-aktion=zahlung]").click()
    seite.locator("#form-zahlung button[value=ok]").click()
    expect(seite.locator("#tabelle-rechnungen tr", has_text="2027-001")).to_contain_text("bezahlt")
    seite.screenshot(path=str(ziel / "4_rechnungen.png"), full_page=True)
    with seite.expect_download() as dx:
        seite.locator("#tabelle-rechnungen tr", has_text="2027-001").locator("button[data-aktion=xml]").click()
    xml = ziel / "browser.xml"
    dx.value.save_as(xml)

    # GoBD: kein Löschen, Storno statt Änderung
    assert seite.locator("#tabelle-rechnungen button[data-aktion=loeschen]").count() == 0
    with seite.expect_download(timeout=60000) as dst:
        seite.locator("#tabelle-rechnungen tr", has_text="2027-001").locator("button[data-aktion=storno]").click()
    dst.value.save_as(ziel / "zugferd_storno_browser.pdf")
    expect(seite.locator("#tabelle-rechnungen tr", has_text="Storno zu 2027-001")).to_have_count(1)
    expect(seite.locator("#tabelle-rechnungen tr", has_text="storniert (2027-003)")).to_have_count(1)
    seite.screenshot(path=str(ziel / "4b_storno.png"), full_page=True)

    # Protokoll
    seite.click("#protokoll-zeigen")
    expect(seite.locator("#protokoll-inhalt")).to_contain_text("Prüfsummenkette intakt")
    seite.screenshot(path=str(ziel / "4c_protokoll.png"))
    seite.locator("#dialog-protokoll button[value=zu]").click()

    # Archivpaket erzeugen und prüfen
    with seite.expect_download() as da:
        seite.click("#archiv-export")
    archiv = ziel / "archiv.zip"
    da.value.save_as(archiv)
    import zipfile
    namen = zipfile.ZipFile(archiv).namelist()
    for pflicht in ("rechnungsausgangsbuch.csv", "index.xml", "protokoll.json", "pruefsummen.sha256", "LIESMICH.txt"):
        assert pflicht in namen, (pflicht, namen)
    assert sum(n.startswith("rechnungen/") and n.endswith(".pdf") for n in namen) == 3, namen
    seite.set_input_files("#archiv-pruefen", str(archiv))
    expect(seite.locator("#archiv-ergebnis")).to_contain_text("unverändert")
    seite.screenshot(path=str(ziel / "4d_archiv.png"), full_page=True)

    # Kunden
    seite.click("button[data-tab=kunden]")
    expect(seite.locator("#tabelle-kunden tbody tr")).to_have_count(2)
    seite.screenshot(path=str(ziel / "5_kunden.png"), full_page=True)

    # XML-Import als Vorlage
    seite.click("button[data-tab=rechnung]")
    seite.set_input_files("#import-xml", str(xml))
    expect(seite.locator("[name='k.name']")).to_have_value("Beispiel Beratung GmbH")
    expect(seite.locator("#positionen .position")).to_have_count(2)

    # Sicherung
    seite.click("button[data-tab=profil]")
    with seite.expect_download() as ds:
        seite.click("#sicherung-export")
    sich = ziel / "sicherung.json"
    ds.value.save_as(sich)
    d = json.loads(sich.read_text())
    assert len(d["rechnungen"]) == 3 and len(d["kunden"]) == 2, d.keys()
    assert len(d["protokoll"]) >= 6, len(d["protokoll"])

    # Mobile Ansicht
    seite.set_viewport_size({"width": 390, "height": 844})
    seite.click("button[data-tab=rechnung]")
    seite.screenshot(path=str(ziel / "6_mobil.png"), full_page=True)
    browser.close()

if fehler:
    print("Browserfehler:", *fehler, sep="\n  ")
    sys.exit(1)
print("E2E OK")

# Regression: Profil-Datei und Sicherung enthalten Eingaben auch ohne Klick auf „Meine Daten speichern“
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=sys.argv[3] if len(sys.argv) > 3 else None)
    s = browser.new_page(accept_downloads=True)
    s.on("dialog", lambda d: d.accept())
    s.goto(basis + "/index.html")
    s.locator("#form-profil [name=name]").fill("Ohne Speichern GmbH")
    with s.expect_download() as d:
        s.click("#profil-export")
    assert json.load(open(d.value.path()))["profil"]["name"] == "Ohne Speichern GmbH", "Profil-Datei leer"
    s.locator("#form-profil [name=ort]").fill("Musterstadt")
    with s.expect_download() as d2:
        s.click("#sicherung-export")
    sicherung = d2.value.path()
    profil = [e for e in json.load(open(sicherung))["einstellungen"] if e["id"] == "profil"][0]["wert"]
    assert profil["ort"] == "Musterstadt", "Sicherung ohne aktuelle Eingabe"
    s2 = browser.new_context().new_page()
    s2.on("dialog", lambda d: d.accept())
    s2.goto(basis + "/index.html")
    s2.set_input_files("#sicherung-import", sicherung)
    expect(s2.locator("#form-profil [name=name]")).to_have_value("Ohne Speichern GmbH")
    browser.close()
print("Regression Profil/Sicherung OK")
