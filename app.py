from flask import Flask, render_template, request

app = Flask(__name__, static_url_path='/static')

@app.route('/')
def vfs_settings():
    return render_template('vfs_settings.html')

@app.route('/vfs_process')
def vfs():
    return render_template('vfs_process.html')

if __name__ == '__main__':
    app.run(port=8080, debug=True)
