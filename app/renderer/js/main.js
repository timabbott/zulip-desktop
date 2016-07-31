		window.onload = function getURL() {
			const request = require('request');
			const JsonDB = require('node-json-db');
			const ipcRenderer = require('electron').ipcRenderer;
			const dialogs = require('dialogs')()
		    const db = new JsonDB("domain", true, true);
		    const data = db.getData("/");

		    if (data["domain"] !== undefined) {
		        window.location.href = data["domain"];
		    } else {

		        dialogs.prompt('Enter the URL for your Zulip server', function(url) {

		        	let newurl = 'https://' + url.replace(/^https?:\/\//,'')
		        	let checkURL = newurl + '/static/audio/zulip.ogg';

		        	request({uri: checkURL, strictSSL: false}, function (error, response, body) {
		        		if (!error && response.statusCode !== 404) {
		        			    db.push("/domain", newurl);
		        			    ipcRenderer.send('new-domain', newurl);
		        			    window.location.href = newurl ;
		        		}
		        		else {
		        			dialogs.alert('Not valid url');
		        			console.log("Not valid url");
		        		}
		        	})
		        })
		    }

		const addPlaceHolder = document.getElementsByTagName('input')[0];
		addPlaceHolder.setAttribute('placeholder', 'zulip.example.com');
		}
