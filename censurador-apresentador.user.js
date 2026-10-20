// ==UserScript==
// @name         CRM SC/RS - Censurador Apresentador
// @namespace    censurador-apresentador
// @version      1.7.0
// @description  Censura dados sensíveis e cobre a tela com marca d'água da GBR
// @match        https://apps.crmsc.org.br/*
// @match        https://crvirtual-hml.crmsc.org.br/*
// @match        https://servicos.cremers.org.br/*
// @match        http://localhost
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

const MARCA_DAGUA = false;

(function () {
  "use strict";

  const URL_ROTULOS =
    "https://raw.githubusercontent.com/Oicanji/Censurador-Apresentador/main/rotulos.txt";
  const URL_PASTAS =
    "https://raw.githubusercontent.com/Oicanji/Censurador-Apresentador/main/pastas.txt";
  const URL_BLUR =
    "https://raw.githubusercontent.com/Oicanji/Censurador-Apresentador/main/blur.txt";
  const URL_LOGO =
    "https://raw.githubusercontent.com/Oicanji/Censurador-Apresentador/main/logo.txt";

  let PASTAS = [];
  let BLUR_CLASSES = [];
  let LOGO_SELS = [];
  let ROTULOS = [];

  const MARCA_ID = "gbr-ap-marca";
  const ACAO_BLUR = "abnt-pasta-acao";
  const CLASSE_CAMPO = "abnt-campo-censura";
  const CLASSE_MASCARA = "abnt-campo-ast";
  const CLASSE_OLHO = "abnt-olho";
  const pastasSemBlur = new WeakSet();

  const originaisTexto = new WeakMap();
  const mascarasCampo = new WeakMap();
  const coresCampo = new WeakMap();
  const camposMascarados = new Set();
  const olhosTexto = new WeakMap();
  const olhosCampo = new WeakMap();
  const textosRevelados = new WeakSet();
  const camposRevelados = new WeakSet();
  let aplicandoCampo = false;
  let loopOn = false;

  function semAcento(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function mascararAlnum(s) {
    return String(s).replace(/[A-Za-zÀ-ÿ0-9]/g, "*");
  }

  function mascararNPalavras(texto, n) {
    const partes = String(texto).split(/(\s+)/);
    let resta = n;
    for (let i = 0; i < partes.length && resta > 0; i++) {
      if (!partes[i] || /^\s+$/.test(partes[i])) continue;
      partes[i] = mascararAlnum(partes[i]);
      resta -= 1;
    }
    return partes.join("");
  }

  function mascararDocumento(s) {
    const texto = String(s);
    let n = 0;
    for (let i = 0; i < texto.length; i++) {
      if (/\d/.test(texto.charAt(i))) n += 1;
    }
    if (!n) return texto;
    let idx = 0;
    let saida = "";
    for (let i = 0; i < texto.length; i++) {
      const ch = texto.charAt(i);
      if (!/\d/.test(ch)) {
        saida += ch;
        continue;
      }
      saida += idx < 3 || idx >= n - 3 ? "*" : ch;
      idx += 1;
    }
    return saida;
  }

  function mascararCpf(num) {
    return mascararDocumento(num);
  }

  function mascararCnpj(num) {
    return mascararDocumento(num);
  }

  function rotuloBate(texto) {
    const t = semAcento(texto);
    if (!t.trim()) return false;
    for (let i = 0; i < ROTULOS.length; i++) {
      if (t.indexOf(ROTULOS[i]) !== -1) return true;
    }
    return false;
  }

  function censurarTexto(bruto) {
    let s = String(bruto);
    s = s.replace(
      /\b(CNPJ\s*:?\s*)?(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})\b/gi,
      function (_, pref, num) {
        return (pref || "") + mascararCnpj(num);
      },
    );
    s = s.replace(
      /\b(CPF\s*:?\s*)?(\d{3}\.\d{3}\.\d{3}-?\d{2})\b/gi,
      function (_, pref, num) {
        return (pref || "") + mascararCpf(num);
      },
    );
    s = s.replace(
      /\b(CREME[A-Z]{1,3})(\s*)(\d{3,8})\b/gi,
      function (_, a, sp, n) {
        return a + sp + mascararAlnum(n);
      },
    );
    s = s.replace(
      /\b(CRF\s*\/?\s*[A-Z]{2})(\s*)(\d{3,8})\b/gi,
      function (_, a, sp, n) {
        return a + sp + mascararAlnum(n);
      },
    );
    s = s.replace(
      /\b(CRM\s*\/?\s*[A-Z]{2})(\s*)(\d{3,8})\b/gi,
      function (_, a, sp, n) {
        return a + sp + mascararAlnum(n);
      },
    );
    s = s.replace(/\b(CRM[A-Z]{2})(\s*)(\d{3,8})\b/gi, function (_, a, sp, n) {
      return a + sp + mascararAlnum(n);
    });
    s = s.replace(
      /\b(Dra\.?|Dr\.?|Sr\.?)(\s+)(\S+)(\s+)(\S+)/g,
      function (_, tit, s1, a, s2, b) {
        return tit + s1 + mascararAlnum(a) + s2 + mascararAlnum(b);
      },
    );
    return s;
  }

  function textoDe(el) {
    if (!el) return "";
    return String(
      el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.textContent ||
        "",
    );
  }

  function rotuloLabelAncestral(el) {
    let node = el;
    for (let d = 0; d < 8 && node; d++) {
      const pai = node.parentElement;
      if (!pai || pai === document.body || pai === document.documentElement)
        break;
      let prev = node.previousElementSibling;
      for (let i = 0; i < 4 && prev; i++) {
        if (prev.tagName === "LABEL") {
          const t = textoDe(prev);
          if (t.trim()) return t;
        }
        const filho = prev.firstElementChild;
        if (
          filho &&
          filho === prev.lastElementChild &&
          filho.tagName === "LABEL"
        ) {
          const t = textoDe(filho);
          if (t.trim()) return t;
        }
        prev = prev.previousElementSibling;
      }
      node = pai;
    }
    return "";
  }

  function acharRotulo(el) {
    if (!el || el.nodeType !== 1) return "";
    const aria = el.getAttribute("aria-label");
    if (aria && rotuloBate(aria)) return aria;
    const ph = el.getAttribute("placeholder");
    if (ph && rotuloBate(ph)) return ph;
    if (el.id) {
      let lab = null;
      try {
        lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      } catch (e) {
        lab = document.querySelector('label[for="' + el.id + '"]');
      }
      if (lab) return textoDe(lab);
    }
    const wrapLab = el.closest && el.closest("label");
    if (wrapLab) return textoDe(wrapLab);
    const campo =
      el.closest &&
      el.closest(
        ".p-field, .p-float-label, .form-group, .mat-form-field, mat-form-field, .field, .form-item",
      );
    if (campo) {
      const lab = campo.querySelector(
        "label, .p-label, mat-label, .mat-form-field-label, legend, dt",
      );
      if (lab) return textoDe(lab);
    }
    const labelPerto = rotuloLabelAncestral(el);
    if (labelPerto) return labelPerto;
    let prev = el.previousElementSibling;
    for (let i = 0; i < 4 && prev; i++) {
      const t = textoDe(prev);
      if (rotuloBate(t)) return t;
      prev = prev.previousElementSibling;
    }
    const td = el.closest && el.closest("td");
    if (td) {
      const tr = td.parentElement;
      if (tr) {
        const ths = tr.querySelectorAll("th");
        if (ths.length) {
          const tds = tr.querySelectorAll("td");
          let idx = -1;
          for (let i = 0; i < tds.length; i++) {
            if (tds[i] === td) idx = i;
          }
          if (idx >= 0 && ths[idx]) return textoDe(ths[idx]);
        }
        const thead = tr.closest("table") && tr.closest("table").tHead;
        if (thead && thead.rows[0]) {
          const tds = tr.querySelectorAll("td");
          let idx = -1;
          for (let i = 0; i < tds.length; i++) {
            if (tds[i] === td) idx = i;
          }
          const cel = thead.rows[0].cells[idx];
          if (idx >= 0 && cel) return textoDe(cel);
        }
        const ant = td.previousElementSibling;
        if (ant && (ant.tagName === "TH" || rotuloBate(textoDe(ant))))
          return textoDe(ant);
      }
    }
    const dd = el.closest && el.closest("dd");
    if (
      dd &&
      dd.previousElementSibling &&
      dd.previousElementSibling.tagName === "DT"
    ) {
      return textoDe(dd.previousElementSibling);
    }
    return "";
  }

  function contextoSensivel(el) {
    return rotuloBate(acharRotulo(el));
  }

  function labelDeCampoSensivel(rotulo) {
    if (rotuloBate(rotulo)) return true;
    const t = semAcento(rotulo);
    return t.indexOf("cpf") !== -1 || t.indexOf("cnpj") !== -1;
  }

  function rotuloVisivel(el) {
    const direto = acharRotulo(el);
    if (direto && direto.trim()) return direto;
    let node = el;
    for (let d = 0; d < 8 && node && node.parentElement; d++) {
      const pai = node.parentElement;
      if (pai === document.body || pai === document.documentElement) break;
      let prev = node.previousElementSibling;
      for (let i = 0; i < 4 && prev; i++) {
        const t = String(prev.innerText || prev.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        if (t && t.length < 80) return t;
        prev = prev.previousElementSibling;
      }
      node = pai;
    }
    return "";
  }

  function pareceMascaraCpfCnpj(s) {
    const t = String(s || "").trim();
    if (!/\./.test(t)) return false;
    if (!/^\d[\d.\-\/\s]*$/.test(t)) return false;
    const digitos = t.replace(/\D/g, "");
    return digitos.length >= 4 && digitos.length <= 14;
  }

  function ehCampoTexto(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName !== "INPUT") return false;
    const tipo = (el.getAttribute("type") || "text").toLowerCase();
    return (
      tipo !== "hidden" &&
      tipo !== "checkbox" &&
      tipo !== "radio" &&
      tipo !== "file" &&
      tipo !== "password" &&
      tipo !== "button" &&
      tipo !== "submit" &&
      tipo !== "reset" &&
      tipo !== "image" &&
      tipo !== "range" &&
      tipo !== "color"
    );
  }

  function textoMascaraCampo(el) {
    const bruto = String(el.value == null ? "" : el.value);
    if (!bruto) return "";
    const rotulo = rotuloVisivel(el);
    const porRotulo = labelDeCampoSensivel(rotulo);
    const porMascara = pareceMascaraCpfCnpj(bruto);
    if (!porRotulo && !porMascara) {
      const padrao = censurarTexto(bruto);
      return padrao === bruto ? "" : padrao;
    }
    const t = semAcento(rotulo);
    if (
      porMascara ||
      t.indexOf("cpf") !== -1 ||
      t.indexOf("cnpj") !== -1
    ) {
      const doc = mascararDocumento(bruto);
      return doc === bruto ? "" : doc;
    }
    const s = censurarTexto(mascararNPalavras(bruto, 3));
    return s === bruto ? "" : s;
  }

  function desenharMascara(txt, bruto, mascara, cor) {
    if (
      txt.getAttribute("data-v") === bruto &&
      txt.getAttribute("data-c") === cor
    )
      return;
    txt.setAttribute("data-v", bruto);
    txt.setAttribute("data-c", cor);
    txt.textContent = "";
    if (mascara.length !== bruto.length) {
      txt.style.color = cor;
      txt.textContent = mascara;
      return;
    }
    for (let i = 0; i < bruto.length; i++) {
      const ch = bruto.charAt(i);
      const vis = mascara.charAt(i);
      const slot = document.createElement("span");
      slot.style.position = "relative";
      slot.style.display = "inline-block";
      slot.style.whiteSpace = "pre";
      const base = document.createElement("span");
      base.textContent = ch;
      slot.appendChild(base);
      if (vis === ch) {
        base.style.color = cor;
      } else {
        base.style.visibility = "hidden";
        const ast = document.createElement("span");
        ast.textContent = vis;
        ast.style.position = "absolute";
        ast.style.left = "0";
        ast.style.top = "0";
        ast.style.color = cor;
        slot.appendChild(ast);
      }
      txt.appendChild(slot);
    }
  }

  function guardarCor(el) {
    if (coresCampo.has(el)) return;
    const c = window.getComputedStyle(el).color;
    if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)") return;
    coresCampo.set(el, c);
  }

  function esconderTexto(el) {
    el.classList.add(CLASSE_CAMPO);
    el.style.setProperty("color", "transparent", "important");
    el.style.setProperty("-webkit-text-fill-color", "transparent", "important");
    el.style.setProperty(
      "caret-color",
      coresCampo.get(el) || "#222",
      "important",
    );
  }

  function restaurarTexto(el) {
    el.classList.remove(CLASSE_CAMPO);
    el.style.removeProperty("color");
    el.style.removeProperty("-webkit-text-fill-color");
    el.style.removeProperty("caret-color");
  }

  function removerMascara(el) {
    restaurarTexto(el);
    removerOlhoCampo(el);
    const cob = mascarasCampo.get(el);
    if (cob && cob.parentNode) cob.remove();
    mascarasCampo.delete(el);
    camposMascarados.delete(el);
  }

  function garantirMascara(el) {
    const pai = el.parentElement;
    if (!pai) return null;
    let cob = mascarasCampo.get(el);
    if (cob && cob.isConnected && cob.parentNode === pai) return cob;
    if (cob && cob.parentNode) cob.remove();
    if (window.getComputedStyle(pai).position === "static")
      pai.style.position = "relative";
    cob = document.createElement("div");
    cob.className = CLASSE_MASCARA;
    cob.setAttribute("aria-hidden", "true");
    const txt = document.createElement("span");
    cob.appendChild(txt);
    pai.insertBefore(cob, el.nextSibling);
    mascarasCampo.set(el, cob);
    camposMascarados.add(el);
    return cob;
  }

  function posicionarMascara(el, cob) {
    const pai = el.parentElement;
    if (!pai || !el.isConnected || !campoVisivel(el)) {
      cob.style.display = "none";
      return;
    }
    const cs = window.getComputedStyle(el);
    const bl = parseFloat(cs.borderLeftWidth) || 0;
    const bt = parseFloat(cs.borderTopWidth) || 0;
    const br = parseFloat(cs.borderRightWidth) || 0;
    const bb = parseFloat(cs.borderBottomWidth) || 0;
    cob.style.display = "flex";
    cob.style.position = "absolute";
    cob.style.left = el.offsetLeft + bl + "px";
    cob.style.top = el.offsetTop + bt + "px";
    cob.style.width = Math.max(0, el.offsetWidth - bl - br - 26) + "px";
    cob.style.height = el.offsetHeight - bt - bb + "px";
    cob.style.zIndex = "2";
    cob.style.pointerEvents = "none";
    cob.style.boxSizing = "border-box";
    cob.style.margin = "0";
    cob.style.overflow = "hidden";
    cob.style.background = "transparent";
    cob.style.border = "0";
    cob.style.padding = cs.padding;
    cob.style.alignItems = el.tagName === "TEXTAREA" ? "flex-start" : "center";
    cob.style.justifyContent =
      cs.textAlign === "right" || cs.textAlign === "end"
        ? "flex-end"
        : cs.textAlign === "center"
          ? "center"
          : "flex-start";
    const txt = cob.firstChild;
    if (!txt) return;
    txt.style.font = cs.font;
    txt.style.letterSpacing = cs.letterSpacing;
    txt.style.lineHeight = cs.lineHeight;
    txt.style.color = coresCampo.get(el) || "#222";
    txt.style.whiteSpace = el.tagName === "TEXTAREA" ? "pre-wrap" : "pre";
    txt.style.transform =
      "translate(" + (-el.scrollLeft) + "px," + (-el.scrollTop) + "px)";
  }

  function ehMarca(node) {
    if (!node) return false;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || !el.closest) return false;
    return el.id === MARCA_ID || Boolean(el.closest("#" + MARCA_ID));
  }

  function ignorarNo(node) {
    if (!node || ehMarca(node)) return true;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || !el.closest) return true;
    if (el.closest("." + CLASSE_MASCARA + ", ." + CLASSE_OLHO)) return true;
    const extra = seletorClassesBlur();
    const sel = extra
      ? "script, style, noscript, " + extra
      : "script, style, noscript";
    try {
      return Boolean(el.closest(sel));
    } catch (e) {
      return Boolean(el.closest("script, style, noscript"));
    }
  }

  function ehNomeDeCampo(el) {
    if (!el || !el.closest) return false;
    const tag = el.tagName;
    if (
      tag === "LABEL" ||
      tag === "LEGEND" ||
      tag === "DT" ||
      tag === "TH" ||
      tag === "H1" ||
      tag === "H2" ||
      tag === "H3" ||
      tag === "H4" ||
      tag === "H5" ||
      tag === "H6"
    )
      return true;
    return Boolean(el.closest("label, legend"));
  }

  function textoEhSoRotulo(texto) {
    const t = String(texto || "").trim();
    if (!t || t.length > 24 || /\d/.test(t)) return false;
    const sem = semAcento(t).replace(/[^a-z]/g, "");
    return sem === "cpf" || sem === "cnpj" || sem === "cpfcnpj";
  }

  function svgOlho() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  }

  function copiarPorSelecao(valor) {
    const ta = document.createElement("textarea");
    ta.value = valor;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {}
    ta.remove();
  }

  function copiarTexto(texto) {
    const valor = String(texto || "");
    if (typeof GM_setClipboard === "function") {
      try {
        GM_setClipboard(valor, "text");
        return;
      } catch (e) {}
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(valor).catch(function () {
        copiarPorSelecao(valor);
      });
      return;
    }
    copiarPorSelecao(valor);
  }

  function criarOlho(aoClicar) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = CLASSE_OLHO;
    btn.setAttribute("aria-label", "Mostrar e copiar");
    btn.innerHTML = svgOlho();
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      aoClicar(btn);
    });
    return btn;
  }

  function removerOlhoTexto(node) {
    const btn = olhosTexto.get(node);
    if (btn && btn.parentNode) btn.remove();
    olhosTexto.delete(node);
    textosRevelados.delete(node);
  }

  function garantirOlhoTexto(node) {
    const pai = node.parentElement;
    if (!pai) return;
    let btn = olhosTexto.get(node);
    if (btn && btn.isConnected && btn.previousSibling === node) return;
    if (btn && btn.parentNode) btn.remove();
    btn = criarOlho(function (b) {
      const original = originaisTexto.get(node);
      if (original == null) return;
      if (textosRevelados.has(node)) {
        textosRevelados.delete(node);
        b.classList.remove(CLASSE_OLHO + "-aberto");
        aplicarNoTexto(node);
        return;
      }
      textosRevelados.add(node);
      node.nodeValue = original;
      b.classList.add(CLASSE_OLHO + "-aberto");
      copiarTexto(original);
    });
    if (textosRevelados.has(node)) btn.classList.add(CLASSE_OLHO + "-aberto");
    if (node.nextSibling) pai.insertBefore(btn, node.nextSibling);
    else pai.appendChild(btn);
    olhosTexto.set(node, btn);
  }

  function removerOlhoCampo(el) {
    const btn = olhosCampo.get(el);
    if (btn && btn.parentNode) btn.remove();
    olhosCampo.delete(el);
    camposRevelados.delete(el);
  }

  function posicionarOlhoCampo(el, btn) {
    btn.style.position = "absolute";
    btn.style.margin = "0";
    btn.style.left = el.offsetLeft + el.offsetWidth - 26 + "px";
    btn.style.top = el.offsetTop + Math.max(0, (el.offsetHeight - 22) / 2) + "px";
    btn.style.zIndex = "3";
  }

  function garantirOlhoCampo(el) {
    const pai = el.parentElement;
    if (!pai) return null;
    let btn = olhosCampo.get(el);
    if (btn && btn.isConnected && btn.parentNode === pai) {
      posicionarOlhoCampo(el, btn);
      return btn;
    }
    if (btn && btn.parentNode) btn.remove();
    if (window.getComputedStyle(pai).position === "static")
      pai.style.position = "relative";
    btn = criarOlho(function (b) {
      const valor = String(el.value || "");
      if (camposRevelados.has(el)) {
        camposRevelados.delete(el);
        b.classList.remove(CLASSE_OLHO + "-aberto");
        aplicarNoCampo(el);
        return;
      }
      camposRevelados.add(el);
      b.classList.add(CLASSE_OLHO + "-aberto");
      const cob = mascarasCampo.get(el);
      if (cob) cob.style.display = "none";
      restaurarTexto(el);
      copiarTexto(valor);
    });
    if (camposRevelados.has(el)) btn.classList.add(CLASSE_OLHO + "-aberto");
    pai.insertBefore(btn, el.nextSibling);
    olhosCampo.set(el, btn);
    posicionarOlhoCampo(el, btn);
    return btn;
  }

  function aplicarNoTexto(node) {
    if (!node || node.nodeType !== 3) return;
    if (ignorarNo(node)) return;
    const pai = node.parentElement;
    if (!pai) return;
    const tag = pai.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") return;
    if (textosRevelados.has(node)) {
      const original = originaisTexto.get(node);
      if (original != null && node.nodeValue !== original) node.nodeValue = original;
      garantirOlhoTexto(node);
      return;
    }
    const atual = node.nodeValue;
    const candidato = originaisTexto.has(node)
      ? originaisTexto.get(node)
      : atual;
    let saida = candidato;
    if (
      !ehNomeDeCampo(pai) &&
      !textoEhSoRotulo(candidato) &&
      contextoSensivel(pai)
    )
      saida = mascararNPalavras(saida, 3);
    saida = censurarTexto(saida);
    if (saida !== candidato) {
      originaisTexto.set(node, candidato);
      if (atual !== saida) node.nodeValue = saida;
      garantirOlhoTexto(node);
      return;
    }
    removerOlhoTexto(node);
    if (originaisTexto.has(node)) originaisTexto.delete(node);
  }

  function campoVisivel(el) {
    if (!el || !el.isConnected || el.hidden) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    const cs = window.getComputedStyle(el);
    if (
      cs.display === "none" ||
      cs.visibility === "hidden" ||
      parseFloat(cs.opacity) === 0
    )
      return false;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      if (node.hidden || node.getAttribute("aria-hidden") === "true")
        return false;
      const st = window.getComputedStyle(node);
      if (
        st.display === "none" ||
        st.visibility === "hidden" ||
        parseFloat(st.opacity) === 0
      )
        return false;
      node = node.parentElement;
    }
    return true;
  }

  function aplicarNoCampo(el) {
    if (aplicandoCampo || !ehCampoTexto(el) || ignorarNo(el)) return;
    if (!campoVisivel(el)) {
      removerMascara(el);
      return;
    }
    aplicandoCampo = true;
    try {
      const mascara = textoMascaraCampo(el);
      if (!mascara) {
        removerMascara(el);
        return;
      }
      if (camposRevelados.has(el)) {
        const cobOculta = mascarasCampo.get(el);
        if (cobOculta) cobOculta.style.display = "none";
        restaurarTexto(el);
        garantirOlhoCampo(el);
        return;
      }
      guardarCor(el);
      esconderTexto(el);
      const cob = garantirMascara(el);
      if (!cob) return;
      const txt = cob.firstChild;
      if (txt)
        desenharMascara(
          txt,
          String(el.value || ""),
          mascara,
          coresCampo.get(el) || "#222",
        );
      posicionarMascara(el, cob);
      garantirOlhoCampo(el);
    } finally {
      aplicandoCampo = false;
    }
  }

  function campoDeveAcompanhar(el) {
    if (!ehCampoTexto(el)) return false;
    if (mascarasCampo.has(el)) return true;
    if (labelDeCampoSensivel(rotuloVisivel(el))) return true;
    return pareceMascaraCpfCnpj(el.value);
  }

  function agendarLoop() {
    if (loopOn) return;
    loopOn = true;
    function tick() {
      const el = document.activeElement;
      if (!campoDeveAcompanhar(el)) {
        loopOn = false;
        return;
      }
      aplicarNoCampo(el);
      if (document.activeElement === el && campoDeveAcompanhar(el))
        window.requestAnimationFrame(tick);
      else loopOn = false;
    }
    window.requestAnimationFrame(tick);
  }

  function limparMascarasSoltas() {
    camposMascarados.forEach(function (el) {
      if (!el.isConnected || !campoVisivel(el)) removerMascara(el);
    });
    const soltas = document.querySelectorAll("body > ." + CLASSE_MASCARA);
    for (let i = 0; i < soltas.length; i++) soltas[i].remove();
  }

  function soltarCampos(node) {
    if (!node || node.nodeType !== 1) return;
    if (ehCampoTexto(node)) removerMascara(node);
    if (!node.querySelectorAll) return;
    const lista = node.querySelectorAll("input, textarea");
    for (let i = 0; i < lista.length; i++) removerMascara(lista[i]);
  }

  function reposicionarMascaras() {
    limparMascarasSoltas();
    camposMascarados.forEach(function (el) {
      const cob = mascarasCampo.get(el);
      if (cob) posicionarMascara(el, cob);
    });
  }

  function vigiarValor(proto) {
    try {
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (!desc || !desc.get || !desc.set || !desc.configurable) return;
      if (desc.set._abnt) return;
      function set(v) {
        desc.set.call(this, v);
        if (aplicandoCampo) return;
        if (
          this !== document.activeElement &&
          !mascarasCampo.has(this) &&
          !this.classList.contains(CLASSE_CAMPO)
        )
          return;
        aplicarNoCampo(this);
      }
      set._abnt = true;
      Object.defineProperty(proto, "value", {
        configurable: true,
        enumerable: desc.enumerable,
        get: function () {
          return desc.get.call(this);
        },
        set: set,
      });
    } catch (e) {}
  }

  function varrer(raiz) {
    if (!raiz || ehMarca(raiz)) return;
    if (
      raiz === document ||
      raiz === document.body ||
      raiz === document.documentElement
    )
      limparMascarasSoltas();
    if (raiz.nodeType === 3) {
      aplicarNoTexto(raiz);
      return;
    }
    if (raiz.nodeType !== 1 && raiz.nodeType !== 9) return;
    const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, null);
    let n = walker.nextNode();
    while (n) {
      aplicarNoTexto(n);
      n = walker.nextNode();
    }
    const campos = (raiz.querySelectorAll ? raiz : document).querySelectorAll(
      "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=password]):not([type=button]):not([type=submit]), textarea",
    );
    for (let i = 0; i < campos.length; i++) aplicarNoCampo(campos[i]);
    aplicarBlurPastas(raiz);
    trocarLogo(raiz);
  }

  function uriDoLogo() {
    if (uriDoLogo.valor) return uriDoLogo.valor;
    const svg = LOGO_SVG.replace(/currentColor/g, "#2F92D0");
    uriDoLogo.valor =
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    return uriDoLogo.valor;
  }

  function aplicarSrcLogo(img) {
    if (!img || img.tagName !== "IMG") return;
    const uri = uriDoLogo();
    if (img.getAttribute("src") === uri) return;
    img.src = uri;
    img.removeAttribute("srcset");
    img.srcset = "";
  }

  function trocarLogo(raiz) {
    const lista = nosPorSeletores(raiz, LOGO_SELS);
    for (let i = 0; i < lista.length; i++) {
      const el = lista[i];
      if (el.tagName === "IMG") {
        aplicarSrcLogo(el);
        continue;
      }
      const imgs = el.querySelectorAll("img");
      if (imgs.length) {
        for (let j = 0; j < imgs.length; j++) aplicarSrcLogo(imgs[j]);
      } else {
        el.style.backgroundImage = 'url("' + uriDoLogo() + '")';
      }
    }
  }

  function classeCss(nome) {
    if (typeof CSS !== "undefined" && CSS.escape) return "." + CSS.escape(nome);
    return "." + nome;
  }

  function seletorClassesBlur() {
    const partes = [];
    for (let i = 0; i < BLUR_CLASSES.length; i++) {
      partes.push(classeCss(BLUR_CLASSES[i]));
    }
    return partes.join(",");
  }

  function nosPorSeletores(raiz, seletores) {
    const lista = [];
    const vistos = new Set();
    function add(el) {
      if (!el || el.nodeType !== 1 || vistos.has(el)) return;
      vistos.add(el);
      lista.push(el);
    }
    for (let i = 0; i < seletores.length; i++) {
      const sel = seletores[i];
      if (!sel) continue;
      if (raiz && raiz.nodeType === 1 && raiz.matches) {
        try {
          if (raiz.matches(sel)) add(raiz);
        } catch (e) {}
      }
      const base = raiz && raiz.querySelectorAll ? raiz : document;
      let nos = [];
      try {
        nos = base.querySelectorAll(sel);
      } catch (e2) {
        nos = [];
      }
      for (let j = 0; j < nos.length; j++) add(nos[j]);
    }
    return lista;
  }

  function criarBotaoBlur(pasta, cob) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = ACAO_BLUR;
    btn.textContent = "Tirar blur";
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      pastasSemBlur.add(pasta);
      cob.remove();
    });
    return btn;
  }

  function aplicarBlurPastas(raiz) {
    if (!BLUR_CLASSES.length) return;
    const lista = nosPorSeletores(raiz, PASTAS);
    const marca = classeCss(BLUR_CLASSES[0]);
    for (let i = 0; i < lista.length; i++) {
      const el = lista[i];
      if (el.nodeType !== 1 || pastasSemBlur.has(el)) continue;
      if (el.querySelector(":scope > " + marca)) continue;
      const st = window.getComputedStyle(el);
      if (st.position === "static") el.style.position = "relative";
      if (st.overflow === "visible") el.style.overflow = "hidden";
      const cob = document.createElement("div");
      cob.className = BLUR_CLASSES.join(" ");
      cob.appendChild(criarBotaoBlur(el, cob));
      el.appendChild(cob);
    }
  }

  function garantirEstilos() {
    let css =
      seletorClassesBlur() +
      "{position:absolute;inset:0;z-index:2147483645;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);background:rgba(255,255,255,0.28);pointer-events:none}" +
      "." +
      ACAO_BLUR +
      "{position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:2;pointer-events:auto;border:0;border-radius:4px;padding:6px 12px;background:#1a1a1a;color:#fff;font:600 13px/1.2 Arial,Helvetica,sans-serif;cursor:pointer}" +
      "input." +
      CLASSE_CAMPO +
      ",textarea." +
      CLASSE_CAMPO +
      "{color:transparent !important;-webkit-text-fill-color:transparent !important;caret-color:#222 !important}" +
      "input." +
      CLASSE_CAMPO +
      "::selection,textarea." +
      CLASSE_CAMPO +
      "::selection{color:transparent !important;-webkit-text-fill-color:transparent !important;background:transparent}" +
      "input." +
      CLASSE_CAMPO +
      ":-webkit-autofill,textarea." +
      CLASSE_CAMPO +
      ":-webkit-autofill{-webkit-text-fill-color:transparent !important}" +
      "." +
      CLASSE_MASCARA +
      "{position:absolute;z-index:2;margin:0;pointer-events:none;overflow:hidden;background:transparent;border:0;user-select:none;box-sizing:border-box}" +
      "." +
      CLASSE_OLHO +
      "{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin:0 0 0 4px;padding:0;border:0;border-radius:4px;background:transparent;color:#3a3a3a;cursor:pointer;vertical-align:middle;line-height:0}" +
      "." +
      CLASSE_OLHO +
      " svg{display:block;width:16px;height:16px;pointer-events:none}" +
      "." +
      CLASSE_OLHO +
      "-aberto{color:#1a73e8}";
    if (MARCA_DAGUA)
      css +=
        "#" +
        MARCA_ID +
        "{position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden;user-select:none;-webkit-user-select:none;background:transparent !important;opacity:.4 !important;--gbr-linhas:2;--gbr-vert:2}" +
        ".gbr-ap-logos{position:absolute;inset:0;display:grid;place-items:center;color:#2F92D0}" +
        ".gbr-ap-logos .gbr-ap-logo{width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:visible}" +
        ".gbr-ap-logos .gbr-ap-logo svg{width:min(32vw,320px);height:auto;display:block;transform:rotate(-45deg);transform-origin:center}" +
        ".gbr-ap-vert{position:absolute;inset:0 1.5% 0 1.5%;display:flex;justify-content:space-between;z-index:1;color:#1a1a1a}" +
        ".gbr-ap-vert-col{width:12%;height:100%;display:flex;flex-direction:column;justify-content:space-evenly;align-items:center;padding:4vh 0;box-sizing:border-box}" +
        ".gbr-ap-vert-col span{writing-mode:vertical-rl;font-family:Arial,Helvetica,sans-serif;font-weight:800;letter-spacing:.04em;line-height:1.15;white-space:nowrap;max-height:42%;font-size:clamp(11px,calc(100vh / var(--gbr-vert) * 0.032),16px)}" +
        ".gbr-ap-avisos{position:absolute;inset:0;display:grid;z-index:2}" +
        "#" +
        MARCA_ID +
        "[data-vert='1'] .gbr-ap-avisos{left:13%;right:13%}" +
        ".gbr-ap-selo{height:100%;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:1.5% 3%;box-sizing:border-box;color:#1a1a1a;font-family:Arial,Helvetica,sans-serif;overflow:hidden}" +
        ".gbr-ap-escudo{width:clamp(18px,calc(100vh / var(--gbr-linhas) * 0.07),36px);height:auto;color:#8b929a;margin:0 0 .25rem;flex:0 0 auto}" +
        ".gbr-ap-t1,.gbr-ap-t2,.gbr-ap-t3{font-weight:800;letter-spacing:-.03em;line-height:1.12;max-width:100%;white-space:nowrap;flex:0 0 auto}" +
        ".gbr-ap-t1{font-size:clamp(13px,calc(100vh / var(--gbr-linhas) * 0.085),38px)}" +
        ".gbr-ap-t2,.gbr-ap-t3{font-size:clamp(12px,calc(100vh / var(--gbr-linhas) * 0.07),32px);margin-top:.16rem}" +
        "#" +
        MARCA_ID +
        "[data-cols='1'] .gbr-ap-t1{font-size:clamp(15px,4.2vw,36px)}" +
        "#" +
        MARCA_ID +
        "[data-cols='1'] .gbr-ap-t2,#" +
        MARCA_ID +
        "[data-cols='1'] .gbr-ap-t3{font-size:clamp(13px,3.5vw,30px)}" +
        ".gbr-ap-rodape{margin-top:.4rem;max-width:24em;color:#8e959d;font-weight:600;font-size:clamp(10px,calc(100vh / var(--gbr-linhas) * 0.04),16px);line-height:1.25;flex:0 0 auto}" +
        ".gbr-ap-selo-logo{width:min(48%,220px);height:auto;max-height:14%;margin-top:.35rem;flex:0 1 auto;color:#2F92D0}" +
        ".gbr-ap-selo-logo svg{width:100%;height:auto;display:block}";
    if (typeof GM_addStyle === "function") {
      GM_addStyle(css);
      return;
    }
    if (document.getElementById(MARCA_ID + "-css")) return;
    const s = document.createElement("style");
    s.id = MARCA_ID + "-css";
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  function medidasMarca() {
    const w = window.innerWidth || 1280;
    const h = window.innerHeight || 720;
    let avisosC = 2;
    let avisosR = 2;
    if (w < 860) avisosC = 1;
    if (h < 480) avisosR = 1;
    else if (h >= 760) avisosR = 3;
    const vertN = w < 980 ? 0 : 2;
    const logoC = w < 760 ? 2 : 3;
    const logoR = h < 560 ? 2 : 3;
    return {
      avisosC: avisosC,
      avisosR: avisosR,
      vertN: vertN,
      logoC: logoC,
      logoR: logoR,
      sig: avisosC + "x" + avisosR + "/" + logoC + "x" + logoR + "/v" + vertN,
    };
  }

  function criarLinha(classe, texto) {
    const el = document.createElement("div");
    el.className = classe;
    el.textContent = texto;
    return el;
  }

  function criarEscudo() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 28");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "gbr-ap-escudo");
    const corpo = document.createElementNS(ns, "path");
    corpo.setAttribute(
      "d",
      "M12 2.4L20.2 5.3V13.1C20.2 18.2 16.7 22.3 12 24.6C7.3 22.3 3.8 18.2 3.8 13.1V5.3L12 2.4Z",
    );
    corpo.setAttribute("stroke", "currentColor");
    corpo.setAttribute("stroke-width", "1.5");
    corpo.setAttribute("stroke-linejoin", "round");
    const traco = document.createElementNS(ns, "path");
    traco.setAttribute("d", "M12 8.4V14.6");
    traco.setAttribute("stroke", "currentColor");
    traco.setAttribute("stroke-width", "1.7");
    traco.setAttribute("stroke-linecap", "round");
    const ponto = document.createElementNS(ns, "circle");
    ponto.setAttribute("cx", "12");
    ponto.setAttribute("cy", "18.1");
    ponto.setAttribute("r", "0.95");
    ponto.setAttribute("fill", "currentColor");
    svg.appendChild(corpo);
    svg.appendChild(traco);
    svg.appendChild(ponto);
    return svg;
  }

  function criarLogo(extra) {
    const holder = document.createElement("span");
    holder.className = "gbr-ap-logo" + (extra ? " " + extra : "");
    holder.innerHTML = LOGO_SVG;
    const svg = holder.firstElementChild;
    if (svg) {
      svg.setAttribute("aria-hidden", "true");
      svg.removeAttribute("width");
      svg.removeAttribute("height");
    }
    return holder;
  }

  function criarColunaVertical(qtd, inicio) {
    const col = document.createElement("div");
    col.className = "gbr-ap-vert-col";
    for (let i = 0; i < qtd; i++) {
      const linha = document.createElement("span");
      linha.textContent =
        (i + inicio) % 2 === 0
          ? "GBR – SOFTWARE PROPRIETÁRIO"
          : "EXCLUSIVO PARA ACOMPANHAMENTO DA PoC";
      col.appendChild(linha);
    }
    return col;
  }

  function criarSelo() {
    const selo = document.createElement("div");
    selo.className = "gbr-ap-selo";
    selo.appendChild(criarEscudo());
    selo.appendChild(criarLinha("gbr-ap-t1", "GBR – SOFTWARE PROPRIETÁRIO"));
    selo.appendChild(criarLinha("gbr-ap-t2", "EXCLUSIVO PARA ACOMPANHAMENTO"));
    selo.appendChild(criarLinha("gbr-ap-t3", "DA PoC"));
    const rodape = document.createElement("div");
    rodape.className = "gbr-ap-rodape";
    rodape.appendChild(
      document.createTextNode("Reprodução, redistribuição e utilização não"),
    );
    rodape.appendChild(document.createElement("br"));
    rodape.appendChild(document.createTextNode("autorizadas proibidas"));
    selo.appendChild(rodape);
    selo.appendChild(criarLogo("gbr-ap-selo-logo"));
    return selo;
  }

  function montarMarca(m) {
    const raiz = document.createElement("div");
    raiz.id = MARCA_ID;
    raiz.setAttribute("aria-hidden", "true");
    raiz.setAttribute("data-sig", m.sig);
    raiz.setAttribute("data-cols", String(m.avisosC));
    raiz.setAttribute("data-vert", m.vertN ? "1" : "0");
    raiz.style.setProperty("--gbr-linhas", String(m.avisosR));
    raiz.style.setProperty("--gbr-vert", String(Math.max(m.vertN, 1)));
    raiz.style.setProperty("opacity", "0.4", "important");
    raiz.style.setProperty("background", "transparent", "important");
    const logos = document.createElement("div");
    logos.className = "gbr-ap-logos";
    logos.style.gridTemplateColumns = "repeat(" + m.logoC + ", 1fr)";
    logos.style.gridTemplateRows = "repeat(" + m.logoR + ", 1fr)";
    const nLogos = m.logoC * m.logoR;
    for (let i = 0; i < nLogos; i++) logos.appendChild(criarLogo());
    raiz.appendChild(logos);
    if (m.vertN) {
      const vert = document.createElement("div");
      vert.className = "gbr-ap-vert";
      vert.appendChild(criarColunaVertical(m.vertN, 0));
      vert.appendChild(criarColunaVertical(m.vertN, 1));
      raiz.appendChild(vert);
    }
    const avisos = document.createElement("div");
    avisos.className = "gbr-ap-avisos";
    avisos.style.gridTemplateColumns = "repeat(" + m.avisosC + ", 1fr)";
    avisos.style.gridTemplateRows = "repeat(" + m.avisosR + ", 1fr)";
    const nAvisos = m.avisosC * m.avisosR;
    for (let i = 0; i < nAvisos; i++) avisos.appendChild(criarSelo());
    raiz.appendChild(avisos);
    return raiz;
  }

  function garantirMarca() {
    const m = medidasMarca();
    const atual = document.getElementById(MARCA_ID);
    if (atual && atual.getAttribute("data-sig") === m.sig) return;
    if (atual) atual.remove();
    document.documentElement.appendChild(montarMarca(m));
  }

  let marcaTimer = 0;
  function agendarMarca() {
    if (marcaTimer) window.clearTimeout(marcaTimer);
    marcaTimer = window.setTimeout(function () {
      marcaTimer = 0;
      garantirMarca();
    }, 150);
  }

  function iniciar() {
    garantirEstilos();
    if (MARCA_DAGUA) garantirMarca();
    vigiarValor(HTMLInputElement.prototype);
    vigiarValor(HTMLTextAreaElement.prototype);
    varrer(document.body);
    function aoEditarCampo(ev) {
      const el = ev.target;
      if (!ehCampoTexto(el)) return;
      aplicarNoCampo(el);
      if (campoDeveAcompanhar(el)) agendarLoop();
    }
    document.addEventListener(
      "beforeinput",
      function (ev) {
        const el = ev.target;
        if (!campoDeveAcompanhar(el)) return;
        guardarCor(el);
        esconderTexto(el);
        agendarLoop();
      },
      true,
    );
    document.addEventListener("input", aoEditarCampo, true);
    document.addEventListener("input", aoEditarCampo, false);
    document.addEventListener("keydown", aoEditarCampo, false);
    document.addEventListener("keyup", aoEditarCampo, false);
    document.addEventListener("focusin", aoEditarCampo, true);
    window.addEventListener("scroll", reposicionarMascaras, true);
    window.addEventListener("resize", reposicionarMascaras);
    window.addEventListener("hashchange", limparMascarasSoltas);
    window.addEventListener("popstate", limparMascarasSoltas);
    const obs = new MutationObserver(function (muts) {
      for (let i = 0; i < muts.length; i++) {
        const m = muts[i];
        if (m.type === "characterData") {
          if (!ehMarca(m.target)) aplicarNoTexto(m.target);
        }
        const fora = m.removedNodes;
        for (let k = 0; k < fora.length; k++) soltarCampos(fora[k]);
        const nos = m.addedNodes;
        for (let j = 0; j < nos.length; j++) {
          const n = nos[j];
          if (ehMarca(n)) continue;
          if (n.nodeType === 3) aplicarNoTexto(n);
          else if (n.nodeType === 1) varrer(n);
        }
      }
      limparMascarasSoltas();
      if (MARCA_DAGUA && !document.getElementById(MARCA_ID)) garantirMarca();
    });
    obs.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    if (MARCA_DAGUA) window.addEventListener("resize", agendarMarca);
    setInterval(function () {
      varrer(document.body);
      if (MARCA_DAGUA && !document.getElementById(MARCA_ID)) garantirMarca();
    }, 500);
  }

  function linhasDe(texto) {
    return String(texto || "")
      .split(/\r?\n/)
      .map(function (linha) {
        return linha.trim();
      })
      .filter(function (linha) {
        return linha && linha.charAt(0) !== "#";
      });
  }

  function classesDe(texto) {
    return linhasDe(texto).map(function (linha) {
      return linha.replace(/^\.+/, "");
    });
  }

  function baixar(url) {
    const alvo = url + "?t=" + Date.now();
    return new Promise(function (resolve, reject) {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: "GET",
          url: alvo,
          onload: function (res) {
            if (res.status >= 200 && res.status < 300)
              resolve(res.responseText);
            else reject(new Error(url + " " + res.status));
          },
          onerror: function () {
            reject(new Error(url));
          },
        });
        return;
      }
      fetch(alvo, { cache: "no-store" })
        .then(function (res) {
          if (!res.ok) throw new Error(url + " " + res.status);
          return res.text();
        })
        .then(resolve, reject);
    });
  }

  function carregarRemoto() {
    return Promise.all([
      baixar(URL_ROTULOS),
      baixar(URL_PASTAS),
      baixar(URL_BLUR),
      baixar(URL_LOGO),
    ]).then(function (partes) {
      const rotulos = linhasDe(partes[0]).map(semAcento);
      const pastas = linhasDe(partes[1]);
      const blur = classesDe(partes[2]);
      const logos = linhasDe(partes[3]);
      if (!rotulos.length || !pastas.length || !blur.length || !logos.length) {
        throw new Error("configuracao remota incompleta");
      }
      ROTULOS = rotulos;
      PASTAS = pastas;
      BLUR_CLASSES = blur;
      LOGO_SELS = logos;
    });
  }

  function quandoPronto(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
      return;
    }
    fn();
  }

  function tentarIniciar() {
    carregarRemoto().then(
      function () {
        quandoPronto(iniciar);
      },
      function (err) {
        console.warn(
          "Censurador Apresentador: configuracao remota indisponivel.",
          err,
        );
        window.setTimeout(tentarIniciar, 5000);
      },
    );
  }

  const LOGO_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1744 342"><path fill="currentColor" d="M292.41 0.1C300.74 0.1 309.08 0.1 317.41 0.1C320.9 1 324.38 1.9 327.87 2.8C327.97 3.02 328.07 3.24 328.16 3.45C328.73 3.43 329.3 3.41 329.87 3.39C330.34 3.57 330.82 3.76 331.3 3.95C331.71 4.12 332.11 4.3 332.52 4.48C344.63 6.98 352.79 16.67 362.19 23.53C372.7 31.19 381.36 41.34 391.53 49.41C399.7 55.91 408.95 63.08 415.84 70.92C416.19 71.08 416.54 71.23 416.88 71.39C447.54 98.55 478.19 125.72 508.85 152.89C509.2 153.05 509.55 153.2 509.9 153.36C516.27 159.11 522.64 164.87 529.01 170.62C493.97 201.56 458.93 232.5 423.9 263.45C423.53 263.61 423.17 263.77 422.8 263.93C414.33 273.75 398.4 286.51 388.04 294.74C366.5 311.85 354.07 329.27 326.71 338.43C326.22 338.4 325.74 338.36 325.26 338.33C325.15 338.56 325.04 338.79 324.93 339.02C319.71 339.92 314.49 340.82 309.27 341.73C305.98 341.73 302.68 341.73 299.39 341.73C295.7 341.14 292.01 340.56 288.31 339.97C287.94 339.84 287.56 339.7 287.18 339.56C282.14 338.03 277.1 336.5 272.05 334.97C271.67 334.78 271.29 334.58 270.9 334.39C269.34 333.62 267.78 332.86 266.22 332.1C265.84 331.88 265.47 331.67 265.09 331.45C249.07 321.8 236.9 307.45 222.36 295.9C200.03 278.16 179.12 257.91 157.72 239.04C148.52 230.92 139.54 222.15 129.93 214.51C126.98 212.17 121.15 208.7 120.34 204.92C128.47 197.75 136.61 190.58 144.75 183.41C145.39 183.51 146.03 183.6 146.67 183.7C147.06 183.87 147.44 184.03 147.83 184.2C191.22 222.4 234.6 260.6 277.99 298.81C278.35 298.96 278.72 299.11 279.08 299.27C281.03 300.42 282.98 301.57 284.93 302.72C285.31 302.92 285.68 303.12 286.06 303.31C287.24 303.81 288.42 304.31 289.59 304.8C289.95 304.91 290.31 305.02 290.67 305.12C291.8 305.32 292.94 305.51 294.07 305.7C294.49 305.88 294.9 306.07 295.32 306.26C296.68 306.44 298.04 306.63 299.4 306.81C299.49 306.99 299.58 307.16 299.68 307.34C300.56 307.17 301.44 306.99 302.32 306.82C303.7 306.82 305.07 306.82 306.44 306.82C306.51 306.96 306.58 307.1 306.65 307.24C307.62 307.27 308.59 307.3 309.56 307.34C309.64 307.16 309.73 306.98 309.81 306.8C310.11 306.85 310.42 306.9 310.72 306.94C311.79 306.72 312.85 306.49 313.92 306.27C314.31 306.08 314.7 305.89 315.09 305.7C316.05 305.51 317.02 305.32 317.99 305.13C318.38 304.98 318.77 304.83 319.17 304.69C322.8 302.89 326.43 301.09 330.06 299.29C330.43 299.13 330.81 298.97 331.18 298.81C337.8 292.96 344.42 287.11 351.05 281.26C351.41 281.1 351.78 280.94 352.14 280.78C393.66 244.06 435.18 207.34 476.69 170.62C463.86 159.09 451.02 147.56 438.18 136.03C437.81 135.87 437.43 135.71 437.06 135.55C421.49 121.76 404.22 104.13 387.77 92.12C379.02 85.74 372.09 76.99 363.35 70.61C351.04 61.63 339.83 45.41 325.97 39.2C325.6 38.97 325.23 38.73 324.85 38.5C322.57 37.7 320.29 36.91 318.02 36.11C317.62 35.93 317.22 35.75 316.83 35.57C313.7 35.08 310.57 34.6 307.44 34.12C306.5 34.01 305.56 33.89 304.62 33.78C304.42 33.78 304.23 33.78 304.04 33.78C303.36 33.76 302.68 33.75 302 33.73C301.91 33.89 301.81 34.05 301.72 34.21C298.61 34.66 295.51 35.11 292.41 35.57C291.93 35.6 291.44 35.63 290.96 35.66C290.88 35.8 290.81 35.94 290.73 36.09C286.48 38.24 282.23 40.39 277.97 42.55C277.61 42.7 277.24 42.86 276.87 43.02C233.32 81.39 189.76 119.75 146.21 158.12C137.58 150.47 128.96 142.81 120.34 135.16C129.96 126.51 139.58 117.86 149.21 109.21C149.59 109.04 149.98 108.88 150.37 108.71C169.61 91.61 188.85 74.51 208.1 57.42C208.43 57.27 208.76 57.12 209.09 56.97C225.74 42.41 242.39 27.85 259.03 13.3C259.45 13.13 259.87 12.96 260.29 12.79C264.21 10.63 268.14 8.48 272.06 6.32C272.45 6.11 272.83 5.9 273.22 5.69C274.39 5.29 275.56 4.88 276.73 4.48C277.1 4.3 277.47 4.12 277.85 3.94C278.63 3.76 279.42 3.58 280.2 3.4C280.57 3.23 280.93 3.06 281.3 2.9C282.09 2.68 282.89 2.47 283.69 2.26C284.26 2.12 284.82 1.99 285.39 1.86C287.63 1.43 289.88 1.01 292.12 0.58C292.22 0.42 292.31 0.26 292.41 0.1ZM688.25 14.05C733.06 13.99 777.87 13.93 822.68 13.87C827.88 14.05 833.08 14.23 838.28 14.42C841.4 14.6 844.52 14.79 847.63 14.98C847.71 15.13 847.79 15.28 847.87 15.43C848.46 15.42 849.04 15.42 849.62 15.42C849.69 15.27 849.77 15.13 849.85 14.98C852.78 15.25 855.72 15.51 858.65 15.78C859.61 15.93 860.57 16.07 861.54 16.21C863.28 16.38 865.03 16.55 866.77 16.71C866.87 16.95 866.96 17.18 867.06 17.42C868.12 17.4 869.19 17.38 870.26 17.36C871.45 17.53 872.64 17.7 873.83 17.87C873.9 18.03 873.97 18.19 874.03 18.35C875.31 18.38 876.59 18.41 877.86 18.44C880.17 18.91 882.48 19.38 884.79 19.85C885.18 19.99 885.57 20.14 885.95 20.28C886.92 20.46 887.89 20.63 888.86 20.81C888.96 21.03 889.05 21.24 889.15 21.46C889.63 21.44 890.12 21.43 890.6 21.41C892.34 21.83 894.07 22.25 895.81 22.66C896.21 22.84 896.6 23.01 897 23.19C897.58 23.35 898.17 23.52 898.75 23.68C898.85 23.91 898.94 24.15 899.03 24.38C899.52 24.37 900 24.35 900.49 24.34C901.04 24.52 901.59 24.7 902.15 24.88C902.6 25.07 903.04 25.26 903.49 25.45C905.25 26.27 907.02 27.08 908.78 27.9C909.12 28.07 909.45 28.24 909.79 28.41C912.74 30.18 915.7 31.95 918.66 33.72C919.06 33.89 919.46 34.05 919.86 34.22C923.12 37.48 926.37 40.74 929.63 43.99C929.8 44.4 929.97 44.8 930.13 45.21C931.93 47.97 933.73 50.73 935.53 53.49C935.71 53.9 935.89 54.31 936.07 54.71C936.25 55.08 936.43 55.44 936.62 55.81C936.83 56.21 937.03 56.62 937.24 57.02C938.01 59.06 938.78 61.09 939.55 63.12C939.55 63.69 939.54 64.25 939.54 64.82C939.75 64.91 939.96 65 940.17 65.08C940.34 65.67 940.5 66.26 940.67 66.85C940.87 67.26 941.08 67.67 941.28 68.07C941.46 69.02 941.64 69.97 941.82 70.92C941.99 71.32 942.16 71.73 942.33 72.13C942.56 72.88 942.8 73.64 943.03 74.39C942.86 74.69 942.68 74.99 942.51 75.28C942.69 75.39 942.86 75.5 943.04 75.6C943 75.88 942.96 76.16 942.92 76.45C943.15 77.32 943.37 78.19 943.6 79.06C943.58 80.32 943.56 81.58 943.53 82.84C943.76 82.94 943.99 83.03 944.22 83.13C944.39 85.07 944.56 87 944.73 88.94C944.71 90.59 944.68 92.24 944.65 93.89C944.83 93.98 945.01 94.08 945.19 94.18C945.16 101.96 945.13 109.73 945.09 117.51C944.99 118.3 944.89 119.09 944.79 119.88C932.93 119.85 921.07 119.82 909.21 119.79C908.95 115.36 908.7 110.92 908.44 106.49C908.48 104.42 908.51 102.35 908.54 100.28C908.33 100.18 908.12 100.08 907.91 99.98C907.73 98.63 907.55 97.27 907.37 95.92C907.22 95.16 907.07 94.41 906.92 93.65C906.1 90.21 905.27 86.77 904.44 83.33C904.24 82.87 904.05 82.41 903.85 81.95C903.67 81.37 903.49 80.8 903.32 80.22C903.28 79.74 903.24 79.26 903.2 78.77C903.07 78.73 902.94 78.68 902.81 78.64C902.01 77.04 901.2 75.43 900.39 73.83C900.18 73.46 899.96 73.08 899.75 72.71C897.54 67.97 892.54 63.24 888.26 60.19C886.57 58.98 884.23 58.54 882.95 56.97C882.89 56.8 882.82 56.63 882.75 56.46C882.25 56.48 881.75 56.51 881.25 56.53C880.29 56.15 879.33 55.76 878.36 55.38C877.99 55.16 877.61 54.93 877.23 54.71C876.48 54.52 875.74 54.34 874.99 54.15C874.57 53.96 874.16 53.77 873.74 53.58C873.14 53.4 872.54 53.23 871.94 53.06C871.86 52.88 871.79 52.71 871.71 52.53C871.24 52.52 870.77 52.51 870.3 52.5C869.68 52.38 869.05 52.27 868.43 52.15C868.07 52.04 867.71 51.92 867.35 51.81C866.36 51.56 865.38 51.31 864.39 51.06C863.44 50.92 862.49 50.79 861.54 50.65C860.01 50.48 858.48 50.3 856.96 50.12C856.84 49.88 856.71 49.63 856.59 49.39C854.95 49.44 853.3 49.49 851.65 49.54C789.34 49.54 727.03 49.54 664.72 49.54C662.6 49.5 660.48 49.45 658.36 49.4C658.24 49.65 658.13 49.9 658.01 50.14C656.68 50.31 655.34 50.48 654 50.65C653.23 50.8 652.47 50.94 651.7 51.09C649.38 51.73 647.05 52.37 644.73 53.01C644.24 52.86 643.74 52.71 643.25 52.56C643.17 52.72 643.1 52.89 643.03 53.06C642.42 53.23 641.82 53.4 641.21 53.57C640.8 53.77 640.39 53.97 639.98 54.17C638.09 54.96 636.2 55.74 634.31 56.53C633.89 56.72 633.47 56.91 633.05 57.1C632.75 57.28 632.46 57.45 632.16 57.63C631.73 57.8 631.29 57.97 630.86 58.13C629.66 58.94 628.46 59.76 627.26 60.57C626.87 60.81 626.49 61.05 626.1 61.29C618.88 68.44 612.08 74.62 609.22 84.83C609.05 85.23 608.89 85.63 608.73 86.04C608.56 86.62 608.4 87.21 608.23 87.79C608 87.88 607.77 87.98 607.54 88.07C607.56 88.75 607.58 89.43 607.6 90.11C607.37 90.59 607.14 91.08 606.91 91.56C606.95 91.83 607 92.11 607.04 92.38C606.86 92.5 606.69 92.61 606.51 92.72C606.68 93.04 606.86 93.36 607.03 93.68C606.77 95.01 606.51 96.34 606.25 97.67C606.1 98.05 605.95 98.44 605.81 98.83C605.56 101.75 605.32 104.67 605.07 107.59C604.94 110.68 604.8 113.76 604.67 116.85C604.67 155.8 604.67 194.75 604.67 233.7C604.63 236.7 604.59 239.7 604.55 242.71C604.76 242.81 604.98 242.92 605.19 243.03C605.4 245.73 605.6 248.43 605.81 251.14C605.76 251.62 605.71 252.1 605.65 252.59C605.87 252.71 606.08 252.84 606.3 252.96C606.54 254.09 606.78 255.22 607.03 256.35C606.86 256.65 606.69 256.94 606.53 257.24C606.7 257.33 606.87 257.42 607.04 257.51C607.22 258.49 607.4 259.46 607.59 260.44C607.61 260.92 607.63 261.41 607.65 261.89C607.83 261.97 608.01 262.05 608.19 262.13C611.22 270.96 615.07 277.64 621 284.85C621.34 285 621.68 285.15 622.02 285.3C626.72 289.15 631.91 291.34 636.73 294.74C636.77 294.85 636.81 294.97 636.85 295.09C637.34 295.13 637.82 295.18 638.3 295.22C638.55 295.45 638.8 295.67 639.04 295.9C639.09 296.02 639.13 296.15 639.18 296.28C639.83 296.28 640.48 296.29 641.13 296.29C642.7 296.74 644.27 297.19 645.84 297.65C645.94 297.85 646.05 298.05 646.15 298.26C646.64 298.22 647.12 298.19 647.61 298.15C648.75 298.33 649.89 298.52 651.03 298.7C651.15 298.93 651.27 299.16 651.38 299.39C652.06 299.35 652.74 299.31 653.42 299.27C654.45 299.43 655.47 299.58 656.5 299.74C656.54 299.92 656.58 300.1 656.62 300.28C656.89 300.13 657.16 299.98 657.43 299.83C660.17 300.11 662.91 300.38 665.65 300.65C666.8 300.79 667.96 300.93 669.11 301.07C728.22 301.07 787.32 301.07 846.42 301.07C847.87 301.12 849.33 301.16 850.78 301.21C850.9 300.99 851.02 300.78 851.14 300.56C855.18 300.13 859.23 299.7 863.28 299.26C864.15 299.27 865.02 299.28 865.9 299.29C865.98 299.1 866.07 298.9 866.16 298.7C867.33 298.52 868.5 298.34 869.67 298.15C870.24 298.02 870.8 297.89 871.37 297.76C872.35 297.51 873.34 297.25 874.33 297C874.69 296.84 875.06 296.69 875.43 296.53C875.83 296.46 876.22 296.39 876.62 296.32C877.02 296.14 877.42 295.96 877.82 295.79C878.33 295.6 878.85 295.41 879.36 295.22C879.99 295.09 880.63 294.96 881.27 294.83C883.52 293.61 885.77 292.39 888.03 291.17C888.45 291 888.87 290.83 889.28 290.67C893.88 287.37 896.56 283.35 899.9 278.93C900.07 278.58 900.24 278.23 900.4 277.88C900.54 277.46 900.68 277.04 900.82 276.62C901.04 276.26 901.26 275.9 901.49 275.54C901.9 274.38 902.31 273.22 902.72 272.07C902.94 271.97 903.17 271.87 903.4 271.77C903.37 271.29 903.34 270.8 903.31 270.32C903.5 269.53 903.7 268.74 903.89 267.96C904.07 267.5 904.26 267.04 904.44 266.58C905.22 262.78 906 258.97 906.78 255.17C906.97 255.09 907.17 255 907.36 254.91C907.36 253.66 907.37 252.4 907.37 251.14C907.55 249.39 907.73 247.64 907.91 245.89C908.11 245.79 908.31 245.7 908.51 245.61C908.49 242.75 908.47 239.89 908.45 237.03C908.3 227.94 908.15 218.85 908 209.76C854.09 209.62 800.19 209.48 746.29 209.33C746.31 209.12 746.33 208.91 746.35 208.7C746.35 197.46 746.35 186.22 746.35 174.98C746.57 174.76 746.79 174.54 747.01 174.31C814.03 174.34 881.04 174.37 948.06 174.4C948.11 197.84 948.17 221.28 948.23 244.72C948 244.82 947.77 244.93 947.55 245.03C947.58 248.62 947.62 252.2 947.66 255.79C947.48 258.49 947.3 261.19 947.12 263.89C946.89 264 946.66 264.11 946.44 264.22C946.48 265.86 946.52 267.51 946.56 269.16C946.09 272.65 945.63 276.14 945.16 279.63C945.02 280.01 944.88 280.4 944.73 280.78C944.52 281.46 944.3 282.14 944.09 282.82C944.13 283.11 944.18 283.4 944.23 283.7C944 283.79 943.77 283.89 943.54 283.98C943.56 284.66 943.58 285.34 943.61 286.02C943.43 286.63 943.25 287.24 943.08 287.85C942.93 287.92 942.77 287.98 942.62 288.05C942.59 288.51 942.56 288.97 942.53 289.43C941.73 291.58 940.93 293.73 940.13 295.88C939.94 296.27 939.75 296.67 939.57 297.06C936.81 301.19 934.05 305.33 931.3 309.46C931.13 309.86 930.96 310.26 930.79 310.65C928.5 312.93 926.21 315.21 923.92 317.49C923.52 317.65 923.12 317.82 922.72 317.99C917.86 321.13 913 324.27 908.14 327.41C907.73 327.59 907.32 327.77 906.91 327.96C905.15 328.53 903.4 329.11 901.65 329.68C901.28 329.83 900.92 329.97 900.55 330.12C900.31 330.21 900.08 330.29 899.84 330.38C899.38 330.35 898.91 330.31 898.45 330.28C898.35 330.49 898.24 330.7 898.13 330.91C897.37 331.09 896.6 331.27 895.83 331.45C895.35 331.4 894.87 331.35 894.38 331.3C894.25 331.55 894.13 331.79 894 332.04C893.06 332.22 892.12 332.4 891.18 332.59C890.76 332.75 890.35 332.91 889.93 333.08C887.44 333.51 884.95 333.95 882.46 334.39C881.4 334.35 880.33 334.32 879.27 334.29C879.16 334.51 879.06 334.74 878.95 334.96C877.22 335.14 875.48 335.32 873.74 335.5C872.03 335.65 870.31 335.81 868.59 335.96C865.46 336.19 862.34 336.42 859.21 336.65C857.76 336.66 856.3 336.67 854.85 336.68C854.76 336.86 854.68 337.03 854.59 337.21C851.28 337.42 847.97 337.64 844.66 337.85C786.93 337.85 729.19 337.85 671.45 337.85C668.36 337.62 665.27 337.38 662.18 337.15C662.07 336.94 661.96 336.73 661.85 336.53C660.59 336.57 659.33 336.61 658.07 336.65C655.15 336.41 652.24 336.17 649.32 335.92C648.17 335.78 647.01 335.64 645.86 335.5C644.6 335.29 643.34 335.07 642.08 334.85C641.78 334.9 641.48 334.95 641.17 334.99C641.09 334.79 641 334.59 640.92 334.38C639.66 334.39 638.4 334.39 637.14 334.4C634.83 334 632.51 333.6 630.19 333.21C630.09 332.96 629.98 332.71 629.87 332.47C629.39 332.51 628.91 332.55 628.42 332.58C627.66 332.42 626.89 332.25 626.12 332.09C626.02 331.84 625.91 331.59 625.81 331.35C625.32 331.38 624.84 331.41 624.35 331.44C623.56 331.27 622.77 331.09 621.98 330.92C621.9 330.73 621.82 330.55 621.74 330.37C621.23 330.36 620.73 330.36 620.23 330.36C618.89 329.96 617.55 329.56 616.21 329.16C615.83 328.94 615.44 328.73 615.05 328.52C614.44 328.33 613.83 328.14 613.23 327.94C612.87 327.76 612.5 327.58 612.14 327.4C609.76 326.2 607.38 325 605 323.8C604.67 323.65 604.34 323.5 604.01 323.35C592.97 319.4 582.86 307.5 577.2 297.64C577.06 297.26 576.92 296.88 576.78 296.49C575.34 293.79 573.9 291.09 572.46 288.39C572.42 287.89 572.37 287.39 572.32 286.89C572.23 286.86 572.13 286.82 572.03 286.79C571.43 285.37 570.82 283.95 570.22 282.53C570 282.16 569.79 281.79 569.57 281.42C569.19 280.05 568.81 278.67 568.44 277.3C568.4 276.81 568.37 276.33 568.34 275.84C568.17 275.77 568 275.69 567.83 275.62C567.65 274.82 567.48 274.02 567.31 273.23C567.16 272.66 567 272.09 566.85 271.52C566.62 270.34 566.39 269.17 566.16 267.99C565.99 267.58 565.83 267.17 565.66 266.75C565.43 266.03 565.19 265.31 564.96 264.59C565.16 263.88 565.36 263.18 565.55 262.47C565.35 262.35 565.14 262.23 564.93 262.11C564.75 260.58 564.57 259.06 564.38 257.53C564.39 256.66 564.4 255.79 564.4 254.91C564.22 254.83 564.04 254.74 563.85 254.65C563.65 252.51 563.45 250.37 563.24 248.23C563.26 246.78 563.28 245.32 563.3 243.87C563.13 243.77 562.96 243.68 562.78 243.58C562.78 199.79 562.78 155.99 562.78 112.2C562.96 112.1 563.14 112 563.32 111.91C563.29 110.45 563.27 109 563.25 107.55C563.44 105.04 563.63 102.54 563.82 100.03C564.05 99.92 564.27 99.81 564.49 99.7C564.46 98.63 564.42 97.57 564.38 96.5C564.55 95.32 564.73 94.15 564.9 92.97C565.09 92.89 565.29 92.81 565.48 92.72C565.47 91.64 565.47 90.56 565.46 89.48C565.53 88.72 565.59 87.97 565.65 87.21C565.82 86.82 565.99 86.43 566.16 86.04C566.38 84.71 566.59 83.37 566.8 82.04C567.02 81.92 567.24 81.8 567.45 81.68C567.41 81.19 567.36 80.71 567.31 80.22C567.51 79.22 567.72 78.22 567.92 77.22C568.09 76.59 568.26 75.96 568.43 75.32C568.87 74.02 569.3 72.72 569.74 71.42C569.9 71.06 570.06 70.7 570.22 70.34C570.42 69.58 570.61 68.81 570.81 68.05C570.99 67.57 571.18 67.08 571.36 66.6C571.55 66.07 571.74 65.55 571.93 65.02C572.11 64.65 572.29 64.28 572.46 63.91C577.99 49.84 587.42 41.49 598.01 31.31C598.41 31.15 598.82 30.98 599.23 30.81C602.37 29.02 605.51 27.22 608.66 25.43C609.06 25.25 609.47 25.06 609.88 24.88C610.15 24.92 610.42 24.96 610.69 25C610.98 24.78 611.27 24.56 611.56 24.33C612.05 24.34 612.53 24.35 613.02 24.36C613.07 24.19 613.13 24.01 613.19 23.83C613.33 23.64 613.46 23.45 613.6 23.25C615.63 22.64 617.67 22.03 619.7 21.41C620.12 21.22 620.53 21.02 620.95 20.83C621.89 20.64 622.83 20.46 623.77 20.28C624.32 20.16 624.88 20.04 625.43 19.91C627.16 19.42 628.89 18.93 630.62 18.44C631.73 18.42 632.83 18.39 633.94 18.37C633.98 18.17 634.02 17.97 634.06 17.77C635.09 17.63 636.11 17.49 637.14 17.36C638.01 17.4 638.89 17.44 639.76 17.49C639.87 17.25 639.98 17.01 640.1 16.78C642.02 16.59 643.94 16.4 645.86 16.21C646.54 16.25 647.22 16.28 647.9 16.32C648 16.13 648.1 15.95 648.2 15.76C651.5 15.5 654.8 15.24 658.1 14.98C658.18 15.13 658.27 15.27 658.36 15.42C658.94 15.42 659.52 15.43 660.1 15.43C660.18 15.28 660.26 15.13 660.34 14.98C663.46 14.79 666.58 14.6 669.7 14.41C675.88 14.29 682.06 14.17 688.25 14.05ZM1244.03 17.89C1250.09 18.07 1256.14 18.25 1262.2 18.44C1263.7 18.48 1265.21 18.53 1266.72 18.57C1266.82 18.79 1266.92 19.01 1267.02 19.23C1267.89 19.2 1268.76 19.17 1269.63 19.14C1272.71 19.36 1275.8 19.58 1278.88 19.8C1278.99 20.01 1279.11 20.21 1279.22 20.41C1280.29 20.37 1281.36 20.32 1282.42 20.27C1283.95 20.46 1285.48 20.64 1287.01 20.82C1287.13 21.06 1287.24 21.3 1287.36 21.54C1288.04 21.49 1288.72 21.45 1289.4 21.4C1290.38 21.59 1291.36 21.77 1292.33 21.96C1292.42 22.13 1292.51 22.3 1292.59 22.47C1292.9 22.3 1293.21 22.13 1293.52 21.97C1296 22.59 1298.48 23.22 1300.96 23.84C1301.37 24.01 1301.78 24.17 1302.19 24.33C1302.77 24.5 1303.36 24.67 1303.95 24.84C1304.04 25.05 1304.13 25.27 1304.22 25.48C1304.74 25.47 1305.25 25.46 1305.77 25.44C1306.61 25.68 1307.45 25.92 1308.29 26.16C1308.43 26.35 1308.57 26.55 1308.71 26.74C1308.76 26.91 1308.82 27.07 1308.87 27.23C1309.36 27.24 1309.84 27.25 1310.33 27.25C1315.9 30.34 1321.12 34.06 1326.59 37.1C1326.69 37.49 1326.79 37.88 1326.89 38.27C1327.24 38.28 1327.59 38.28 1327.94 38.29C1332.68 42.76 1337.12 48.57 1339.54 54.65C1339.73 55.05 1339.91 55.45 1340.1 55.85C1340.66 57.58 1341.22 59.31 1341.78 61.04C1341.96 61.43 1342.15 61.82 1342.33 62.21C1342.75 64.15 1343.16 66.08 1343.58 68.02C1343.54 68.89 1343.5 69.76 1343.46 70.63C1343.69 70.75 1343.93 70.86 1344.16 70.97C1344.12 71.25 1344.08 71.52 1344.04 71.79C1344.26 73.05 1344.48 74.31 1344.7 75.57C1344.8 76.51 1344.91 77.45 1345.01 78.38C1345.04 90.45 1345.06 102.51 1345.09 114.57C1344.96 115.52 1344.83 116.48 1344.7 117.43C1344.48 118.3 1344.26 119.17 1344.04 120.05C1344.09 120.32 1344.14 120.6 1344.19 120.88C1343.95 120.99 1343.7 121.1 1343.46 121.21C1343.5 122.08 1343.54 122.95 1343.58 123.82C1343.14 125.76 1342.7 127.7 1342.27 129.64C1342.11 130.03 1341.94 130.41 1341.78 130.8C1341.62 131.4 1341.45 132 1341.29 132.6C1341.07 132.97 1340.85 133.34 1340.63 133.71C1337.9 142.38 1332.15 148.25 1325.06 153.55C1324.65 153.72 1324.23 153.89 1323.82 154.05C1320.3 155.85 1316.78 157.65 1313.26 159.44C1312.87 159.63 1312.48 159.82 1312.09 160C1311.5 160.18 1310.91 160.36 1310.33 160.53C1309.77 160.67 1309.21 160.8 1308.65 160.93C1308.05 161.18 1307.44 161.42 1306.84 161.67C1306.45 161.86 1306.07 162.05 1305.68 162.24C1304.2 162.65 1302.72 163.06 1301.25 163.48C1300.49 163.5 1299.74 163.53 1298.99 163.56C1298.92 163.74 1298.84 163.91 1298.77 164.09C1298.36 164.52 1297.95 164.96 1297.54 165.39C1298.67 165.5 1299.8 165.61 1300.94 165.72C1301.06 165.93 1301.19 166.14 1301.31 166.35C1302.19 166.3 1303.06 166.25 1303.93 166.19C1305.27 166.37 1306.61 166.55 1307.95 166.74C1308.06 166.97 1308.18 167.21 1308.29 167.45C1308.97 167.41 1309.65 167.37 1310.33 167.33C1311.3 167.51 1312.28 167.69 1313.25 167.88C1313.34 168.06 1313.43 168.24 1313.52 168.41C1313.98 168.24 1314.44 168.07 1314.9 167.89C1315.5 168.11 1316.11 168.32 1316.72 168.54C1317.11 168.73 1317.49 168.92 1317.88 169.11C1318.47 169.35 1319.07 169.6 1319.66 169.85C1320.42 169.98 1321.19 170.11 1321.95 170.25C1332.74 173.73 1340.87 179.78 1347.62 188.74C1347.78 189.16 1347.95 189.57 1348.11 189.99C1348.92 191.5 1349.73 193.01 1350.54 194.52C1350.75 194.99 1350.96 195.46 1351.17 195.93C1352.13 198.43 1353.08 200.93 1354.04 203.42C1353.86 203.73 1353.68 204.03 1353.5 204.34C1353.68 204.44 1353.86 204.53 1354.05 204.63C1354.23 205.6 1354.42 206.57 1354.6 207.54C1354.57 208.21 1354.53 208.89 1354.49 209.57C1354.72 209.69 1354.95 209.8 1355.18 209.92C1355.37 211.64 1355.55 213.37 1355.74 215.09C1355.72 216.35 1355.7 217.61 1355.67 218.87C1355.86 218.97 1356.04 219.06 1356.22 219.16C1356.2 235.26 1356.18 251.36 1356.16 267.46C1356.02 269.19 1355.88 270.92 1355.74 272.65C1355.55 274.37 1355.36 276.1 1355.18 277.82C1354.94 277.94 1354.71 278.05 1354.48 278.17C1354.52 278.85 1354.56 279.52 1354.6 280.2C1354.37 280.88 1354.15 281.56 1353.93 282.24C1353.97 282.53 1354.01 282.82 1354.05 283.11C1353.86 283.21 1353.68 283.3 1353.5 283.4C1353.68 283.71 1353.86 284.01 1354.04 284.32C1353.39 286.06 1352.74 287.79 1352.08 289.53C1351.95 289.91 1351.81 290.29 1351.67 290.67C1350.53 293.37 1349.4 296.07 1348.27 298.77C1348.05 299.17 1347.84 299.57 1347.63 299.97C1343.13 307.33 1337.68 312.36 1330.87 317.5C1330.48 317.66 1330.09 317.83 1329.7 317.99C1328.35 318.8 1327 319.61 1325.64 320.41C1325.09 320.42 1324.54 320.43 1323.99 320.44C1323.94 320.59 1323.89 320.75 1323.84 320.9C1320.88 322.09 1317.93 323.28 1314.98 324.47C1314.21 324.61 1313.45 324.74 1312.69 324.87C1312.09 325.12 1311.5 325.36 1310.91 325.61C1310.52 325.76 1310.13 325.91 1309.75 326.06C1307.61 326.51 1305.48 326.95 1303.35 327.4C1302.67 327.36 1301.99 327.32 1301.31 327.28C1301.2 327.52 1301.09 327.77 1300.97 328.01C1300.7 327.97 1300.43 327.92 1300.15 327.87C1299.47 328.09 1298.8 328.31 1298.12 328.53C1297.44 328.51 1296.76 328.48 1296.08 328.46C1295.99 328.63 1295.89 328.79 1295.79 328.96C1294.05 329.2 1292.3 329.44 1290.56 329.67C1290.08 329.64 1289.59 329.6 1289.11 329.56C1289 329.79 1288.9 330.03 1288.79 330.26C1288.05 330.3 1287.32 330.33 1286.58 330.37C1285.1 330.39 1283.61 330.41 1282.13 330.43C1282.06 330.59 1281.99 330.76 1281.91 330.92C1280.34 331.1 1278.76 331.27 1277.19 331.45C1275.67 331.56 1274.15 331.67 1272.63 331.78C1269.88 332.05 1267.14 332.32 1264.4 332.59C1262.47 332.72 1260.55 332.86 1258.62 332.99C1233.94 334.91 1208.82 334.27 1183.89 334.27C1147.26 334.27 1110.64 334.27 1074.01 334.27C1056.19 334.27 1038.36 334.27 1020.53 334.27C1014 334.27 1003.43 336.25 997.45 333.84C997.48 228.58 997.51 123.31 997.54 18.05C1079.7 17.99 1161.87 17.94 1244.03 17.89ZM1634.08 17.87C1639.96 18.06 1645.83 18.25 1651.7 18.44C1653.02 18.48 1654.33 18.52 1655.65 18.55C1655.74 18.76 1655.83 18.97 1655.93 19.18C1656.8 19.16 1657.67 19.15 1658.54 19.14C1661.64 19.36 1664.73 19.58 1667.82 19.81C1667.93 20 1668.03 20.19 1668.14 20.39C1669.2 20.35 1670.27 20.31 1671.33 20.28C1672.87 20.44 1674.41 20.61 1675.94 20.78C1676.05 21.03 1676.16 21.28 1676.27 21.53C1677.53 21.48 1678.79 21.44 1680.05 21.4C1680.93 21.63 1681.8 21.86 1682.67 22.09C1682.94 22.05 1683.2 22 1683.47 21.96C1683.59 22.13 1683.71 22.3 1683.83 22.46C1684.12 22.3 1684.4 22.13 1684.69 21.97C1685.37 22.2 1686.06 22.44 1686.74 22.67C1687.03 22.62 1687.33 22.57 1687.62 22.52C1687.72 22.75 1687.81 22.98 1687.9 23.21C1688.39 23.21 1688.87 23.2 1689.35 23.19C1690.23 23.41 1691.1 23.62 1691.97 23.83C1692.26 23.79 1692.54 23.75 1692.83 23.71C1692.93 23.95 1693.03 24.19 1693.13 24.43C1693.62 24.4 1694.1 24.37 1694.59 24.34C1695.37 24.51 1696.15 24.68 1696.93 24.84C1697.02 25.06 1697.11 25.27 1697.2 25.49C1697.93 25.47 1698.66 25.46 1699.39 25.44C1700.88 25.87 1702.36 26.3 1703.85 26.73C1704.25 26.91 1704.65 27.08 1705.05 27.25C1705.64 27.43 1706.23 27.61 1706.82 27.78C1707.2 27.99 1707.58 28.19 1707.96 28.4C1709.9 29.16 1711.84 29.92 1713.78 30.69C1714.17 30.89 1714.55 31.1 1714.93 31.31C1717.88 33.47 1720.82 35.63 1723.77 37.79C1724.17 37.96 1724.58 38.12 1724.99 38.29C1725.17 38.52 1725.36 38.75 1725.55 38.98C1725.69 39.3 1725.84 39.63 1725.98 39.96C1727.55 41.67 1729.13 43.38 1730.7 45.09C1730.87 45.5 1731.04 45.92 1731.21 46.33C1733.37 50.26 1735.52 54.2 1737.68 58.13C1737.83 58.51 1737.98 58.89 1738.13 59.26C1738.6 60.66 1739.07 62.05 1739.54 63.45C1739.71 63.82 1739.88 64.2 1740.04 64.58C1740.23 65.73 1740.42 66.87 1740.61 68.02C1740.78 68.77 1740.95 69.52 1741.12 70.28C1741.33 71.46 1741.53 72.65 1741.74 73.83C1741.71 74.51 1741.68 75.19 1741.65 75.86C1741.83 75.97 1742.01 76.07 1742.2 76.17C1743.15 99.93 1743.57 123.9 1742.17 147.67C1742.01 147.76 1741.86 147.86 1741.7 147.95C1741.71 148.43 1741.73 148.92 1741.74 149.4C1741.56 150.55 1741.37 151.7 1741.18 152.85C1740.95 152.96 1740.73 153.07 1740.51 153.18C1740.54 153.67 1740.57 154.15 1740.6 154.63C1740.42 155.43 1740.25 156.22 1740.07 157.02C1739.88 157.39 1739.7 157.75 1739.52 158.12C1737.72 162.03 1735.92 165.94 1734.12 169.85C1733.92 170.2 1733.73 170.55 1733.53 170.9C1729.7 174.43 1725.86 177.95 1722.03 181.48C1721.65 181.64 1721.27 181.8 1720.89 181.96C1717.94 183.53 1714.98 185.1 1712.03 186.67C1711.63 186.89 1711.23 187.11 1710.83 187.33C1709.75 187.7 1708.68 188.08 1707.61 188.46C1707.05 188.5 1706.48 188.55 1705.92 188.6C1705.89 188.71 1705.85 188.82 1705.81 188.93C1705.36 189.15 1704.92 189.37 1704.47 189.59C1703.98 189.57 1703.5 189.56 1703.02 189.54C1702.92 189.78 1702.83 190.01 1702.73 190.25C1701.21 190.82 1699.68 191.38 1698.15 191.95C1697.84 191.81 1697.52 191.66 1697.2 191.52C1697.13 191.67 1697.07 191.81 1697 191.95C1696.19 192.14 1695.39 192.33 1694.59 192.52C1693.71 192.52 1692.84 192.52 1691.97 192.52C1691.89 192.73 1691.8 192.95 1691.71 193.16C1691.51 193.2 1691.3 193.25 1691.1 193.29C1691.2 193.78 1691.29 194.26 1691.39 194.75C1691.87 194.72 1692.35 194.69 1692.83 194.66C1692.93 194.89 1693.03 195.12 1693.13 195.35C1693.81 195.32 1694.49 195.28 1695.17 195.25C1695.85 195.47 1696.52 195.69 1697.2 195.91C1697.48 195.86 1697.76 195.82 1698.04 195.77C1698.15 196 1698.26 196.22 1698.37 196.45C1699.07 196.41 1699.77 196.38 1700.47 196.34C1701.84 196.84 1703.2 197.33 1704.56 197.83C1704.92 197.94 1705.28 198.05 1705.63 198.16C1713.94 200.74 1720.56 205.95 1726.65 211.98C1726.82 212.38 1726.98 212.78 1727.14 213.17C1728.33 214.78 1729.51 216.39 1730.7 218C1730.87 218.35 1731.04 218.71 1731.21 219.06C1732.39 221.42 1733.58 223.78 1734.76 226.14C1734.98 226.52 1735.2 226.89 1735.42 227.27C1735.8 228.55 1736.18 229.84 1736.55 231.12C1736.57 231.69 1736.59 232.26 1736.6 232.82C1736.79 232.9 1736.98 232.98 1737.17 233.06C1737.34 233.85 1737.51 234.65 1737.68 235.44C1737.83 236.01 1737.97 236.59 1738.12 237.16C1738.36 238.72 1738.59 240.28 1738.83 241.83C1738.98 242.24 1739.14 242.64 1739.3 243.04C1739.54 244.59 1739.78 246.14 1740.03 247.7C1739.85 276.37 1739.68 305.04 1739.5 333.71C1726.56 333.7 1713.63 333.69 1700.69 333.69C1700.57 309.27 1700.44 284.85 1700.32 260.44C1700.37 258.02 1700.42 255.59 1700.47 253.17C1700.26 253.05 1700.05 252.93 1699.85 252.81C1699.63 250.51 1699.4 248.2 1699.18 245.9C1699.01 245.5 1698.84 245.1 1698.67 244.7C1698.44 243.94 1698.2 243.18 1697.97 242.42C1698.14 242.13 1698.32 241.84 1698.49 241.54C1698.31 241.44 1698.13 241.33 1697.95 241.22C1697.99 240.94 1698.03 240.66 1698.07 240.38C1697.85 239.9 1697.62 239.41 1697.39 238.93C1697.4 238.25 1697.4 237.57 1697.41 236.89C1697.24 236.84 1697.08 236.78 1696.91 236.73C1695.47 234.78 1694.97 232.17 1693.9 230.03C1690.9 224.03 1685.13 219.28 1678.87 216.96C1678.47 216.79 1678.06 216.61 1677.66 216.43C1677.5 216.41 1677.35 216.39 1677.19 216.37C1676.79 216.16 1676.39 215.95 1675.98 215.73C1674.04 215.1 1672.1 214.47 1670.16 213.83C1669.19 213.71 1668.23 213.58 1667.26 213.46C1664.57 213.06 1661.87 212.67 1659.17 212.27C1659.06 212.02 1658.95 211.78 1658.83 211.53C1658.16 211.58 1657.48 211.62 1656.8 211.67C1654.28 211.46 1651.75 211.25 1649.23 211.04C1649.14 210.85 1649.05 210.66 1648.95 210.48C1646.72 210.49 1644.5 210.51 1642.27 210.53C1635.86 210.35 1629.46 210.17 1623.06 209.99C1620.82 208.29 1615.26 209.28 1612.33 209.28C1602.83 209.28 1593.34 209.28 1583.84 209.28C1547.61 209.28 1511.37 209.28 1475.13 209.28C1464.28 209.28 1453.43 209.28 1442.58 209.28C1440.1 209.28 1432.81 208.16 1431.87 210.44C1431.85 251.62 1431.84 292.8 1431.82 333.98C1418.84 333.98 1405.86 333.98 1392.87 333.98C1392.78 228.66 1392.68 123.34 1392.58 18.02C1473.08 17.97 1553.58 17.92 1634.08 17.87ZM1037.17 150.01C1106.73 149.95 1176.28 149.9 1245.84 149.85C1246.11 149.9 1246.39 149.94 1246.67 149.98C1249.29 149.76 1251.9 149.53 1254.52 149.31C1256.55 149.36 1258.59 149.42 1260.62 149.47C1260.75 149.22 1260.88 148.96 1261.01 148.71C1263.11 148.53 1265.21 148.35 1267.31 148.17C1268.18 148.21 1269.05 148.24 1269.92 148.27C1270.02 148.06 1270.12 147.84 1270.22 147.62C1272.93 147.2 1275.64 146.79 1278.35 146.37C1279.22 146.35 1280.1 146.34 1280.97 146.33C1281.05 146.14 1281.12 145.95 1281.2 145.76C1282 145.59 1282.79 145.43 1283.58 145.26C1284.16 145.12 1284.73 144.99 1285.31 144.85C1291.83 141.14 1296.53 139.4 1301.02 132.94C1301.17 132.61 1301.31 132.29 1301.46 131.96C1302.27 130.01 1303.07 128.05 1303.88 126.1C1304.06 125.73 1304.23 125.36 1304.41 124.99C1304.85 123.05 1305.28 121.12 1305.72 119.18C1305.88 118.79 1306.04 118.4 1306.2 118.01C1306.4 116.07 1306.61 114.13 1306.81 112.19C1306.85 104.65 1306.9 97.12 1306.94 89.58C1306.69 87.43 1306.44 85.28 1306.19 83.13C1306.04 82.71 1305.89 82.3 1305.74 81.88C1305.48 80.74 1305.23 79.61 1304.98 78.47C1305.15 78.18 1305.33 77.89 1305.5 77.61C1305.32 77.51 1305.14 77.41 1304.97 77.32C1304.78 76.54 1304.6 75.77 1304.42 74.99C1304.21 74.61 1304.01 74.22 1303.81 73.84C1301.14 66.82 1295.73 60.15 1288.22 58.13C1287.84 57.96 1287.45 57.8 1287.07 57.63C1284.16 56.82 1281.25 56 1278.34 55.18C1278.24 55.02 1278.15 54.86 1278.06 54.69C1277.38 54.7 1276.7 54.71 1276.03 54.72C1275.06 54.55 1274.1 54.38 1273.14 54.22C1273.03 53.97 1272.93 53.73 1272.83 53.48C1271.38 53.52 1269.92 53.55 1268.47 53.58C1266.31 53.4 1264.16 53.21 1262.01 53.03C1261.93 52.87 1261.86 52.71 1261.78 52.54C1258.76 52.7 1255.73 52.86 1252.7 53.01C1245.56 52.77 1238.41 52.53 1231.27 52.29C1166.45 52.12 1101.63 51.95 1036.81 51.78C1036.93 84.52 1037.05 117.26 1037.17 150.01ZM1431.88 52.32C1431.96 92.43 1432.04 132.54 1432.11 172.66C1502.17 172.83 1572.22 173 1642.27 173.17C1644.97 173.03 1647.67 172.89 1650.37 172.76C1654.37 172.29 1658.37 171.82 1662.36 171.35C1663.9 171.34 1665.44 171.32 1666.97 171.31C1667.02 171.17 1667.06 171.04 1667.1 170.91C1667.74 170.69 1668.37 170.47 1669.01 170.25C1669.69 170.25 1670.36 170.25 1671.04 170.24C1671.13 170.07 1671.22 169.89 1671.3 169.71C1672.28 169.51 1673.26 169.31 1674.24 169.11C1674.62 168.88 1675 168.66 1675.38 168.43C1675.8 168.25 1676.21 168.07 1676.62 167.89C1676.89 168.06 1677.17 168.24 1677.44 168.41C1677.53 168.23 1677.62 168.05 1677.71 167.88C1680.81 166.34 1683.92 164.81 1687.03 163.27C1687.39 163.11 1687.74 162.94 1688.1 162.77C1691.21 158.76 1695.84 155.15 1696.82 150C1697.01 149.61 1697.2 149.21 1697.39 148.82C1697.58 148.44 1697.76 148.06 1697.95 147.68C1698.14 147.57 1698.34 147.47 1698.53 147.37C1698.34 147.06 1698.15 146.75 1697.96 146.44C1698.6 144.33 1699.23 142.22 1699.87 140.11C1700.05 140.01 1700.22 139.91 1700.4 139.81C1700.37 139.13 1700.35 138.45 1700.32 137.78C1700.51 136.58 1700.7 135.39 1700.89 134.2C1701.07 132.29 1701.25 130.38 1701.43 128.47C1701.43 118.01 1701.43 107.55 1701.43 97.08C1701.45 95.44 1701.47 93.79 1701.49 92.14C1701.29 92.05 1701.08 91.95 1700.87 91.86C1700.69 90.5 1700.5 89.14 1700.32 87.78C1700.37 86.91 1700.41 86.04 1700.45 85.17C1700.23 85.05 1700 84.94 1699.78 84.83C1699.17 82.93 1698.56 81.04 1697.96 79.15C1698.1 78.83 1698.25 78.51 1698.39 78.19C1698.2 78.15 1698.01 78.12 1697.82 78.08C1697.68 77.63 1697.54 77.18 1697.39 76.74C1697.28 76.38 1697.16 76.02 1697.05 75.66C1696.79 75.05 1696.53 74.44 1696.26 73.83C1696.13 73.44 1695.99 73.06 1695.85 72.67C1692.04 67.75 1688.78 65.2 1685.14 61.04C1684.75 60.88 1684.37 60.72 1683.98 60.56C1682.42 59.75 1680.87 58.94 1679.31 58.13C1679.27 58.01 1679.22 57.88 1679.18 57.75C1678.5 57.72 1677.82 57.68 1677.15 57.64C1676.39 57.45 1675.63 57.26 1674.87 57.07C1674.44 56.89 1674.01 56.71 1673.57 56.53C1672.15 56.1 1670.72 55.66 1669.3 55.23C1669 55.28 1668.7 55.32 1668.39 55.37C1668.31 55.16 1668.22 54.95 1668.14 54.74C1667.46 54.73 1666.78 54.72 1666.1 54.71C1664.76 54.54 1663.42 54.37 1662.08 54.19C1661.97 53.94 1661.85 53.7 1661.74 53.45C1660.68 53.5 1659.61 53.54 1658.54 53.58C1656.96 53.44 1655.38 53.3 1653.79 53.15C1653.73 52.91 1653.67 52.67 1653.6 52.42C1651.28 52.49 1648.95 52.55 1646.63 52.61C1646.55 52.74 1646.48 52.87 1646.41 53C1641.35 52.77 1636.29 52.54 1631.23 52.31C1564.78 52.31 1498.33 52.32 1431.88 52.32ZM53.66 101.73C54.04 101.9 54.43 102.06 54.81 102.23C65.87 112.68 77.33 123.09 89.23 132.54C97.38 139.02 104.34 147 112.49 153.47C116.31 156.51 130.52 167.2 131.38 171.2C108.19 191.67 85 212.14 61.81 232.62C61.42 232.78 61.03 232.95 60.64 233.11C47.89 244.35 35.14 255.59 22.38 266.83C21.68 266.11 20.97 265.4 20.26 264.68C20.1 264.29 19.93 263.9 19.77 263.52C13.21 256.29 6.65 249.06 0.1 241.83C0.1 241.45 0.1 241.06 0.1 240.67C7.77 233.86 15.44 227.05 23.12 220.23C23.5 220.07 23.88 219.91 24.26 219.74C42.72 203.37 61.18 187 79.64 170.62C58.86 152.12 38.07 133.61 17.28 115.1C16.9 114.94 16.51 114.77 16.12 114.61C10.78 109.93 5.44 105.25 0.1 100.57C0.1 99.99 0.1 99.41 0.1 98.83C4.72 93.92 9.33 89.02 13.95 84.12C14.11 83.77 14.26 83.42 14.41 83.07C17.07 80.19 19.73 77.3 22.38 74.41C32.81 83.52 43.23 92.63 53.66 101.73ZM1257.38 297.68C1261.47 297.46 1265.55 297.23 1269.63 297C1270.57 296.88 1271.52 296.75 1272.46 296.62C1273.44 296.52 1274.42 296.41 1275.4 296.31C1276.87 296.31 1278.34 296.31 1279.81 296.31C1279.85 296.09 1279.9 295.87 1279.95 295.65C1280.97 295.51 1281.99 295.37 1283 295.23C1283.68 295.22 1284.36 295.21 1285.04 295.2C1285.12 295.03 1285.2 294.87 1285.29 294.7C1286.46 294.5 1287.64 294.3 1288.82 294.09C1289.37 293.97 1289.92 293.85 1290.47 293.73C1293.02 292.88 1295.57 292.03 1298.12 291.18C1298.5 291.04 1298.89 290.9 1299.27 290.76C1305.39 286.07 1310.86 282.74 1313.66 275.01C1313.88 274.61 1314.1 274.21 1314.32 273.81C1314.5 273.21 1314.68 272.61 1314.86 272.01C1315.04 271.93 1315.22 271.85 1315.41 271.77C1315.42 271.22 1315.43 270.66 1315.44 270.11C1315.88 268.07 1316.33 266.02 1316.77 263.98C1316.93 263.58 1317.08 263.17 1317.24 262.76C1317.42 260.84 1317.6 258.91 1317.79 256.98C1318.02 256.88 1318.26 256.77 1318.49 256.66C1318.45 253.85 1318.41 251.04 1318.37 248.23C1318.37 246.49 1318.37 244.74 1318.37 243C1318.36 239.61 1318.36 236.22 1318.35 232.82C1318.16 232.74 1317.97 232.66 1317.79 232.57C1317.6 230.62 1317.42 228.67 1317.24 226.72C1317.11 225.97 1316.98 225.21 1316.84 224.46C1316.38 222.11 1315.91 219.76 1315.45 217.42C1315.43 216.93 1315.41 216.45 1315.39 215.97C1315.22 215.89 1315.05 215.81 1314.88 215.73C1314.69 215.13 1314.5 214.53 1314.32 213.93C1314.16 213.54 1314 213.14 1313.84 212.75C1313.38 211.59 1312.92 210.44 1312.46 209.28C1312.26 208.92 1312.05 208.56 1311.85 208.21C1311.7 207.79 1311.55 207.37 1311.4 206.95C1311.27 206.56 1311.14 206.17 1311 205.78C1307.65 202.49 1304.29 199.2 1300.93 195.91C1300.58 195.75 1300.22 195.6 1299.86 195.44C1296.55 194.29 1293.24 193.13 1289.93 191.97C1289.85 191.8 1289.77 191.62 1289.69 191.45C1289.19 191.44 1288.68 191.44 1288.18 191.43C1287.6 191.35 1287.02 191.28 1286.44 191.21C1286.07 191.05 1285.7 190.89 1285.33 190.74C1283.97 190.54 1282.61 190.33 1281.26 190.13C1281.16 189.93 1281.06 189.72 1280.97 189.52C1280.1 189.54 1279.22 189.56 1278.35 189.59C1276.98 189.4 1275.6 189.2 1274.23 189.01C1274.15 188.85 1274.07 188.68 1273.99 188.51C1271.76 188.5 1269.54 188.49 1267.31 188.48C1190.57 188.28 1113.83 188.07 1037.1 187.87C1037 224.61 1036.9 261.35 1036.81 298.1C1110.33 297.96 1183.86 297.82 1257.38 297.68Z"/></svg>';

  tentarIniciar();
})();
