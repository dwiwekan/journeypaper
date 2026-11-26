"""Server copies of the front-end content rules (web/js/editor/*.js, web/js/data/paper.js)."""
import pytest

from app.blocks.content import (
    ContentError,
    derive,
    mask_to_keys,
    norm_blocks,
    plain,
    safe_href,
    safe_img,
    sanitize_inline,
    section_key,
)


def test_sanitize_drops_script_and_events():
    assert sanitize_inline('<b onclick="x()">hi</b><script>alert(1)</script>') == "<b>hi</b>"


def test_sanitize_drops_javascript_links():
    assert sanitize_inline('<a href="javascript:alert(1)">x</a>') == "x"


def test_sanitize_keeps_safe_link_with_rel():
    out = sanitize_inline('<a href="https://a.b/" onmouseover="x()">x</a>')
    assert 'href="https://a.b/"' in out
    assert 'rel="noopener noreferrer"' in out
    assert 'target="_blank"' in out
    assert "onmouseover" not in out


def test_sanitize_maps_strong_em_unwraps_others_and_trims_br():
    assert sanitize_inline("<strong>a</strong><em>b</em><span>c</span><br><br>") == "<b>a</b><i>b</i>c"


def test_sanitize_blank_is_empty():
    assert sanitize_inline("<b> </b><br>") == ""


def test_sanitize_escapes_text():
    assert sanitize_inline("1 &lt; 2 &amp; <i>x</i>") == "1 &lt; 2 &amp; <i>x</i>"


def test_sanitize_void_embed_does_not_swallow_the_rest():
    assert sanitize_inline('<embed src="x">after') == "after"


def test_plain_strips_tags_and_entities():
    assert plain("a&nbsp;<b>b</b> &amp; c") == "a b & c"


def test_safe_href_and_img():
    assert safe_href("https://a.b/x") == "https://a.b/x"
    assert safe_href("javascript:alert(1)") == ""
    assert safe_href("ftp://a.b") == ""
    assert safe_img("data:image/png;base64,AAA") == "data:image/png;base64,AAA"
    assert safe_img("data:text/html;base64,AAA") == ""


def test_unknown_type_becomes_p_when_lenient():
    out = norm_blocks([{"id": "x1", "type": "table", "text": "hi"}], strict=False)
    assert out == [{"id": "x1", "type": "p", "text": "hi"}]


def test_unknown_type_raises_when_strict():
    with pytest.raises(ContentError, match="unknown block type: table"):
        norm_blocks([{"type": "table"}], strict=True)


def test_block_caps():
    assert len(norm_blocks([{"type": "divider"}] * 700, strict=True)) == 600
    code = norm_blocks([{"type": "code", "text": "x" * 30000}], strict=True)[0]
    assert len(code["text"]) == 20000


def test_block_fields_and_ids():
    out = norm_blocks(
        [
            {"id": "a b!", "type": "image", "src": "javascript:1", "caption": "c" * 400, "w": "huge"},
            {"id": "ab", "type": "equation", "tex": "x^2"},
            "junk",
        ],
        strict=True,
    )
    assert out[0] == {"id": "ab", "type": "image", "src": "", "caption": "c" * 300, "w": "l"}
    assert out[1]["type"] == "equation" and out[1]["tex"] == "x^2"
    assert out[1]["id"] != "ab"  # duplicate id replaced
    assert len(out) == 2


def test_section_key_aliases():
    assert section_key("Introduction") == "intro"
    assert section_key("Metode") == "method"
    assert section_key("Hasil Eksperimen") == "results"
    assert section_key("My notes") is None


def test_derive_matches_front_end():
    blocks = norm_blocks(
        [
            {"type": "h2", "text": "Introduction"},
            {"type": "p", "text": "Hello <b>x</b>"},
            {"type": "h2", "text": "Metode"},
            {"type": "p", "text": ""},
            {"type": "h2", "text": "My notes"},
            {"type": "p", "text": "z"},
        ],
        strict=True,
    )
    body, mask = derive(blocks)
    assert mask == 1
    assert body == "Hello x\nMy notes\nz"


def test_mask_to_keys():
    assert mask_to_keys(5) == ["intro", "method"]
