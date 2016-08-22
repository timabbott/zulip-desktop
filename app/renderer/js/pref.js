'use strict';
const {remote} = require('electron');

document.getElementById('close-button').addEventListener('click', function (e) {
     let window = remote.getCurrentWindow();
     window.close();
});

// document.getElementById('pic').style.display ='block';

function addDomain() {

        const request = require('request');
        const ipcRenderer = require('electron').ipcRenderer;
        document.getElementById('main').innerHTML = 'checking...'
        document.getElementById('pic').style.display ='block';

        let newDomain = document.getElementById('url').value;
        newDomain = newDomain.replace(/^https?:\/\//,'')

        const domain = 'https://' + newDomain;
        const checkDomain = domain + '/static/audio/zulip.ogg';

        request(checkDomain, function (error, response, body) {
            if (!error && response.statusCode !== 404) {
                document.getElementById('pic').style.display ='none';
                document.getElementById('main').innerHTML = 'Add'
                document.getElementById('urladded').innerHTML = newDomain + '  Added';
                ipcRenderer.send('new-domain', domain);
            }
            else {
                document.getElementById('pic').style.display ='none';
                document.getElementById('main').innerHTML = 'Add'
                document.getElementById('urladded').innerHTML = "Not a vaild Zulip server";
            }
        })
}
