"""Servidor estatico para PIUM PIUM PIUM (sin dependencias, solo Python)."""
import http.server
import os

PORT = 5173


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '': 'application/octet-stream',
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # silenciar el log de peticiones

    def do_PUT(self):
        # solo para desarrollo: guardar capturas del canvas en _shots/
        name = os.path.basename(self.path)
        if not name.endswith(('.jpg', '.png')):
            self.send_error(403)
            return
        os.makedirs('_shots', exist_ok=True)
        length = int(self.headers.get('Content-Length', 0))
        with open(os.path.join('_shots', name), 'wb') as f:
            f.write(self.rfile.read(length))
        self.send_response(204)
        self.end_headers()


if __name__ == '__main__':
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print(f'PIUM PIUM PIUM en http://127.0.0.1:{PORT}')
    server.serve_forever()
