"""
Arena Royale Frontend Server
Serves static files with gzip compression for faster loading
"""

import http.server
import socketserver
import os
import gzip
import io

PORT = 5000
HOST = "0.0.0.0"  # Listen on all network interfaces

# Change to the script's directory
os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Pre-compressed cache for faster responses
_gzip_cache = {}

class FastHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler with gzip compression and caching"""

    def log_message(self, format, *args):
        print(f"[{self.address_string()}] {args[0]}")

    def send_head(self):
        """Override to add gzip compression for text files"""
        path = self.translate_path(self.path)

        # Check if client accepts gzip
        accept_encoding = self.headers.get('Accept-Encoding', '')
        supports_gzip = 'gzip' in accept_encoding

        # Only compress certain file types
        compressible = path.endswith(('.html', '.js', '.css', '.json', '.svg'))

        if supports_gzip and compressible and os.path.isfile(path):
            return self.send_gzipped(path)

        return super().send_head()

    def send_gzipped(self, path):
        """Send a gzipped version of the file"""
        try:
            # Get file modification time for cache validation
            mtime = os.path.getmtime(path)
            cache_key = f"{path}:{mtime}"

            # Check cache
            if cache_key in _gzip_cache:
                compressed_data = _gzip_cache[cache_key]
            else:
                # Read and compress file
                with open(path, 'rb') as f:
                    content = f.read()

                # Compress with gzip
                buf = io.BytesIO()
                with gzip.GzipFile(fileobj=buf, mode='wb', compresslevel=6) as gz:
                    gz.write(content)
                compressed_data = buf.getvalue()

                # Cache the compressed data (limit cache size)
                if len(_gzip_cache) < 50:
                    _gzip_cache[cache_key] = compressed_data

            # Get content type
            ctype = self.guess_type(path)

            # Send response
            self.send_response(200)
            self.send_header("Content-type", ctype)
            self.send_header("Content-Length", len(compressed_data))
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Cache-Control", "public, max-age=300")  # 5 min cache
            self.send_header("Vary", "Accept-Encoding")
            self.end_headers()

            return io.BytesIO(compressed_data)

        except Exception as e:
            print(f"Gzip error: {e}")
            return super().send_head()

def main():
    import socket
    # Get local IP for network access
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except:
        local_ip = "unknown"

    print(f"""
============================================
   Arena Royale Frontend Server (Fast)
============================================

Game:       http://localhost:{PORT}
Dashboard:  http://localhost:{PORT}/dashboard.html

Network:    http://{local_ip}:{PORT}
Dashboard:  http://{local_ip}:{PORT}/dashboard.html

Share the Network URL with others on your network!
Gzip compression enabled for faster loading.

Press Ctrl+C to stop
--------------------------------------------
""")

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer((HOST, PORT), FastHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

if __name__ == "__main__":
    main()
