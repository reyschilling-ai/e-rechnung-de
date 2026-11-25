"""Wandelt kompilierte Schematron-XSLT (KoSIT) in eine JSON-Regelliste für den Browser um."""
import json, sys
from lxml import etree
XSL="http://www.w3.org/1999/XSL/Transform"
SVRL="http://purl.oclc.org/dsdl/svrl"
def extract(path):
    t=etree.parse(path); r=t.getroot()
    ns={k:v for k,v in r.nsmap.items() if k}
    # namespaces declared via ns-prefix-in-attribute-values in svrl output
    for e in r.iter('{%s}ns-prefix-in-attribute-values'%SVRL):
        ns[e.get('prefix')]=e.get('uri')
    globals_=[]
    for v in r.findall('{%s}variable'%XSL)+r.findall('{%s}param'%XSL):
        if v.get('select') is None: 
            globals_.append({"name":v.get('name'),"select":None,"unsupported":True}); continue
        globals_.append({"name":v.get('name'),"select":v.get('select')})
    funcs=[f.get('name') for f in r.findall('{%s}function'%XSL)]
    patterns={}
    for tpl in r.findall('{%s}template'%XSL):
        mode=tpl.get('mode'); m=tpl.get('match')
        if not mode or not mode.startswith('M') or m in (None,'text()','*','/','@*|node()') : continue
        if tpl.get('priority') is None: continue
        rule={"context":m,"priority":int(tpl.get('priority')),"lets":[],"asserts":[]}
        for el in tpl.iter():
            if el.tag=='{%s}variable'%XSL and el.getparent() == tpl:
                rule["lets"].append({"name":el.get('name'),"select":el.get('select')})
            if el.tag=='{%s}choose'%XSL:
                when=el.find('{%s}when'%XSL); oth=el.find('{%s}otherwise'%XSL)
                if when is None or oth is None: continue
                fa=oth.find('{%s}failed-assert'%SVRL)
                if fa is None: continue
                attrs={a.get('name'):(a.text or '') for a in fa.findall('{%s}attribute'%XSL)}
                txt=fa.find('{%s}text'%SVRL)
                rule["asserts"].append({"test":when.get('test'),"id":attrs.get('id',''),"flag":attrs.get('flag','fatal'),
                    "text":" ".join("".join(txt.itertext()).split()) if txt is not None else ""})
            if el.tag=='{%s}if'%XSL:
                sr=el.find('{%s}successful-report'%SVRL)
                if sr is not None:
                    attrs={a.get('name'):(a.text or '') for a in sr.findall('{%s}attribute'%XSL)}
                    txt=sr.find('{%s}text'%SVRL)
                    rule["asserts"].append({"test":el.get('test'),"report":True,"id":attrs.get('id',''),"flag":attrs.get('flag','fatal'),
                        "text":" ".join("".join(txt.itertext()).split()) if txt is not None else ""})
        patterns.setdefault(mode,[]).append(rule)
    for k in patterns: patterns[k].sort(key=lambda r:-r["priority"])
    # fontoxpath rechnet xs:integer mit begrenzter Genauigkeit; die IBAN-Prüfziffer (mod 97)
    # wird deshalb über eine gleichwertige Hilfsfunktion ziffernweise berechnet.
    for p_ in patterns.values():
        for r_ in p_:
            for a in r_["asserts"]:
                if "xs:integer(string-join(" in a["test"] and "mod 97" in a["test"]:
                    a["test"]=a["test"].replace("xs:integer(string-join(","u:mod97(string-join(")
    return {"namespaces":ns,"globals":globals_,"functions":funcs,"patterns":patterns}
if __name__=="__main__":
    out={}
    for name,p in zip(sys.argv[2::2],sys.argv[3::2]): out[name]=extract(p)
    json.dump(out,open(sys.argv[1],'w'),ensure_ascii=False)
