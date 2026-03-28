#!/usr/bin/env python3
"""
Download a Tribucast live cast recording.

Usage:
    python3 download_tribucast.py https://client.tribucast.com/tcid/a26035277800654
    python3 download_tribucast.py https://client.tribucast.com/tcid/a26035277800654 -o output.mp4
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.request
import urllib.error
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


class MediaExtractor(HTMLParser):
    """Extract media URLs and metadata from HTML."""

    def __init__(self):
        super().__init__()
        self.video_sources = []
        self.iframe_sources = []
        self.scripts = []
        self.meta = {}
        self._in_script = False
        self._script_data = ""

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        if tag == "video":
            src = attrs_dict.get("src")
            if src:
                self.video_sources.append(src)
        elif tag == "source":
            src = attrs_dict.get("src")
            if src:
                self.video_sources.append(src)
        elif tag == "iframe":
            src = attrs_dict.get("src")
            if src:
                self.iframe_sources.append(src)
        elif tag == "script":
            self._in_script = True
            self._script_data = ""
        elif tag == "meta":
            prop = attrs_dict.get("property", attrs_dict.get("name", ""))
            content = attrs_dict.get("content", "")
            if prop and content:
                self.meta[prop] = content

    def handle_data(self, data):
        if self._in_script:
            self._script_data += data

    def handle_endtag(self, tag):
        if tag == "script" and self._in_script:
            self._in_script = False
            if self._script_data.strip():
                self.scripts.append(self._script_data)


def fetch_url(url, headers=None):
    """Fetch URL content with custom headers."""
    hdrs = dict(HEADERS)
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, headers=hdrs)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read(), resp.headers


def extract_urls_from_text(text):
    """Extract media-related URLs from text (scripts, JSON, etc.)."""
    urls = set()
    # HLS playlists
    for m in re.finditer(r'(https?://[^\s"\'<>]+\.m3u8[^\s"\'<>]*)', text):
        urls.add(m.group(1))
    # MP4 files
    for m in re.finditer(r'(https?://[^\s"\'<>]+\.mp4[^\s"\'<>]*)', text):
        urls.add(m.group(1))
    # WebM files
    for m in re.finditer(r'(https?://[^\s"\'<>]+\.webm[^\s"\'<>]*)', text):
        urls.add(m.group(1))
    # Generic video URLs
    for m in re.finditer(r'(https?://[^\s"\'<>]*(?:video|stream|media|recording)[^\s"\'<>]*)', text):
        urls.add(m.group(1))
    # Cloudfront or CDN URLs (common for streaming services)
    for m in re.finditer(r'(https?://[^\s"\'<>]*(?:cloudfront|cdn|stream)[^\s"\'<>]*)', text):
        urls.add(m.group(1))
    return urls


def extract_json_objects(text):
    """Try to extract JSON objects from script content."""
    objects = []
    # Look for variable assignments with JSON
    for m in re.finditer(r'(?:var|let|const|window\.)\s*\w+\s*=\s*(\{[^;]+\})\s*;', text, re.DOTALL):
        try:
            obj = json.loads(m.group(1))
            objects.append(obj)
        except (json.JSONDecodeError, ValueError):
            pass
    # Look for JSON.parse calls
    for m in re.finditer(r'JSON\.parse\s*\(\s*[\'"](.+?)[\'"]\s*\)', text):
        try:
            unescaped = m.group(1).encode().decode("unicode_escape")
            obj = json.loads(unescaped)
            objects.append(obj)
        except (json.JSONDecodeError, ValueError, UnicodeDecodeError):
            pass
    return objects


def find_media_in_json(obj, urls=None):
    """Recursively search JSON for media URLs."""
    if urls is None:
        urls = set()
    if isinstance(obj, str):
        if any(ext in obj for ext in (".m3u8", ".mp4", ".webm", "video", "stream", "recording")):
            if obj.startswith("http"):
                urls.add(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            find_media_in_json(v, urls)
    elif isinstance(obj, list):
        for item in obj:
            find_media_in_json(item, urls)
    return urls


def try_tribucast_api(tcid):
    """Try known Tribucast API patterns to get video data."""
    api_patterns = [
        f"https://client.tribucast.com/api/v1/events/{tcid}",
        f"https://client.tribucast.com/api/events/{tcid}",
        f"https://api.tribucast.com/v1/events/{tcid}",
        f"https://api.tribucast.com/events/{tcid}",
        f"https://client.tribucast.com/api/v1/casts/{tcid}",
        f"https://client.tribucast.com/api/casts/{tcid}",
        f"https://client.tribucast.com/tcid/{tcid}/manifest",
        f"https://client.tribucast.com/tcid/{tcid}/video",
    ]

    for api_url in api_patterns:
        try:
            print(f"  Trying API: {api_url}")
            data, headers = fetch_url(api_url)
            content_type = headers.get("Content-Type", "")
            text = data.decode("utf-8", errors="replace")

            if "application/json" in content_type:
                try:
                    obj = json.loads(text)
                    print(f"  Found JSON response from {api_url}")
                    print(f"  Keys: {list(obj.keys()) if isinstance(obj, dict) else type(obj).__name__}")
                    return obj
                except json.JSONDecodeError:
                    pass

            # Check for media URLs in any response
            urls = extract_urls_from_text(text)
            if urls:
                print(f"  Found media URLs in API response: {urls}")
                return {"media_urls": list(urls)}

        except urllib.error.HTTPError as e:
            print(f"  {api_url} -> HTTP {e.code}")
        except Exception as e:
            print(f"  {api_url} -> {e}")

    return None


def download_with_ffmpeg(url, output_path):
    """Download media using ffmpeg (handles HLS/m3u8 streams)."""
    cmd = [
        "ffmpeg", "-y",
        "-headers", f"User-Agent: {HEADERS['User-Agent']}\r\n",
        "-i", url,
        "-c", "copy",
        "-bsf:a", "aac_adtstoasc",
        output_path,
    ]
    print(f"Running: {' '.join(cmd[:6])}... {output_path}")
    subprocess.run(cmd, check=True)


def download_direct(url, output_path):
    """Download a file directly."""
    print(f"Downloading: {url}")
    print(f"Saving to: {output_path}")
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=120) as resp:
        total = resp.headers.get("Content-Length")
        total = int(total) if total else None
        downloaded = 0
        with open(output_path, "wb") as f:
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded * 100 / total
                    print(f"\r  Progress: {pct:.1f}% ({downloaded}/{total})", end="", flush=True)
                else:
                    mb = downloaded / (1024 * 1024)
                    print(f"\r  Downloaded: {mb:.1f} MB", end="", flush=True)
        print()
    print("Download complete!")


def download_media(url, output_path):
    """Download media, using ffmpeg for HLS streams or direct download for files."""
    if ".m3u8" in url:
        download_with_ffmpeg(url, output_path)
    else:
        # Try direct download first
        try:
            download_direct(url, output_path)
        except Exception as e:
            print(f"Direct download failed: {e}")
            print("Trying with ffmpeg...")
            download_with_ffmpeg(url, output_path)


def main():
    parser = argparse.ArgumentParser(description="Download a Tribucast live cast recording")
    parser.add_argument("url", help="Tribucast URL (e.g., https://client.tribucast.com/tcid/a26035277800654)")
    parser.add_argument("-o", "--output", help="Output file path (default: tribucast_<id>.mp4)")
    parser.add_argument("--list-only", action="store_true", help="Only list found media URLs, don't download")
    args = parser.parse_args()

    # Extract the cast ID from the URL
    match = re.search(r'/tcid/([a-zA-Z0-9]+)', args.url)
    if not match:
        print(f"Error: Could not extract cast ID from URL: {args.url}")
        sys.exit(1)

    tcid = match.group(1)
    base_url = args.url.rstrip("/")
    output_path = args.output or f"tribucast_{tcid}.mp4"

    print(f"Cast ID: {tcid}")
    print(f"URL: {base_url}")
    print()

    all_media_urls = set()

    # Step 1: Fetch the main page
    print("[1/3] Fetching main page...")
    try:
        html_data, _ = fetch_url(base_url)
        html_text = html_data.decode("utf-8", errors="replace")
        print(f"  Page size: {len(html_text)} bytes")

        # Parse HTML
        extractor = MediaExtractor()
        extractor.feed(html_text)

        # Collect video sources from HTML tags
        for src in extractor.video_sources:
            full_url = urljoin(base_url, src)
            all_media_urls.add(full_url)
            print(f"  Found video source: {full_url}")

        # Check iframes (may contain embedded players)
        for src in extractor.iframe_sources:
            full_url = urljoin(base_url, src)
            print(f"  Found iframe: {full_url}")
            # Fetch iframe content to look for media
            try:
                iframe_data, _ = fetch_url(full_url)
                iframe_text = iframe_data.decode("utf-8", errors="replace")
                iframe_urls = extract_urls_from_text(iframe_text)
                all_media_urls.update(iframe_urls)
                for u in iframe_urls:
                    print(f"    Found in iframe: {u}")
            except Exception as e:
                print(f"    Could not fetch iframe: {e}")

        # Extract URLs from inline scripts
        for script in extractor.scripts:
            urls = extract_urls_from_text(script)
            all_media_urls.update(urls)
            for u in urls:
                print(f"  Found in script: {u}")

            # Try to parse JSON data from scripts
            json_objects = extract_json_objects(script)
            for obj in json_objects:
                json_urls = find_media_in_json(obj)
                all_media_urls.update(json_urls)
                for u in json_urls:
                    print(f"  Found in JSON: {u}")

        # Also scan full page text for URLs
        page_urls = extract_urls_from_text(html_text)
        new_urls = page_urls - all_media_urls
        all_media_urls.update(new_urls)
        for u in new_urls:
            print(f"  Found in page: {u}")

        # Print meta info
        if extractor.meta:
            print("\n  Page metadata:")
            for k, v in extractor.meta.items():
                print(f"    {k}: {v}")

    except urllib.error.HTTPError as e:
        print(f"  HTTP Error {e.code}: {e.reason}")
        if e.code == 403:
            print("  Page requires authentication or is blocked.")
    except Exception as e:
        print(f"  Error fetching page: {e}")

    # Step 2: Try Tribucast API endpoints
    print(f"\n[2/3] Trying Tribucast API endpoints...")
    api_data = try_tribucast_api(tcid)
    if api_data:
        if isinstance(api_data, dict):
            json_urls = find_media_in_json(api_data)
            all_media_urls.update(json_urls)

            # Look for common video URL keys
            for key in ("video_url", "videoUrl", "stream_url", "streamUrl",
                        "recording_url", "recordingUrl", "hls_url", "hlsUrl",
                        "mp4_url", "mp4Url", "url", "src", "source",
                        "playback_url", "playbackUrl", "media_url", "mediaUrl"):
                if key in api_data and isinstance(api_data[key], str):
                    all_media_urls.add(api_data[key])
                    print(f"  Found '{key}': {api_data[key]}")

            # Check nested structures
            for parent_key in ("video", "recording", "stream", "media", "cast", "event"):
                if parent_key in api_data and isinstance(api_data[parent_key], dict):
                    nested = api_data[parent_key]
                    for key in ("url", "src", "source", "hls", "mp4", "stream_url", "playback_url"):
                        if key in nested and isinstance(nested[key], str):
                            all_media_urls.add(nested[key])
                            print(f"  Found '{parent_key}.{key}': {nested[key]}")

            if "media_urls" in api_data:
                for u in api_data["media_urls"]:
                    all_media_urls.add(u)

    # Step 3: Download
    print(f"\n[3/3] Results")
    if not all_media_urls:
        print("  No media URLs found automatically.")
        print()
        print("  This may be a JavaScript-rendered page. Try these alternatives:")
        print()
        print("  Option A: Use yt-dlp (recommended)")
        print(f"    yt-dlp '{base_url}' -o '{output_path}'")
        print()
        print("  Option B: Use browser DevTools")
        print("    1. Open the URL in your browser")
        print("    2. Open DevTools (F12) -> Network tab")
        print("    3. Filter by 'media' or '.m3u8' or '.mp4'")
        print("    4. Find the video URL and run:")
        print(f"       python3 {sys.argv[0]} <video_url> -o '{output_path}'")
        print()
        print("  Option C: Use this script with a direct media URL")
        print(f"    python3 {sys.argv[0]} <direct_m3u8_or_mp4_url> -o '{output_path}'")
        sys.exit(1)

    # Prioritize URLs: m3u8 > mp4 > others
    prioritized = sorted(all_media_urls, key=lambda u: (
        0 if ".m3u8" in u else (1 if ".mp4" in u else 2)
    ))

    print(f"  Found {len(prioritized)} media URL(s):")
    for i, u in enumerate(prioritized, 1):
        print(f"    [{i}] {u}")

    if args.list_only:
        return

    # Download the best URL
    best_url = prioritized[0]
    print(f"\n  Downloading: {best_url}")
    print(f"  Output: {output_path}")
    print()

    try:
        download_media(best_url, output_path)
        size = os.path.getsize(output_path)
        print(f"\nSaved: {output_path} ({size / (1024*1024):.1f} MB)")
    except FileNotFoundError:
        if ".m3u8" in best_url:
            print("Error: ffmpeg is required for HLS stream downloads.")
            print("Install it with: sudo apt install ffmpeg  (or brew install ffmpeg)")
        else:
            raise
    except Exception as e:
        print(f"Error downloading: {e}")
        if len(prioritized) > 1:
            print(f"\nTry another URL manually:")
            for i, u in enumerate(prioritized[1:], 2):
                print(f"  python3 {sys.argv[0]} '{u}' -o '{output_path}'")
        sys.exit(1)


if __name__ == "__main__":
    main()
