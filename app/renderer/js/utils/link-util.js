'use strict';

const wurl = require('wurl');

let instance = null;

class LinkUtil {
	constructor() {
		if (instance) {
			return instance;
		} else {
			instance = this;
		}

		return instance;
	}

	isInternal(currentUrl, newUrl) {
		const currentDomain = wurl('hostname', currentUrl);
		const newDomain = wurl('hostname', newUrl);

		return (currentDomain === newDomain) && newUrl.includes('/#narrow');
	}

	isImage(url) {
		// test for images extension as well as urls like .png?s=100
		const isImageUrl = /\.(bmp|gif|jpg|jpeg|png|webp)\?*.*$/i;
		return isImageUrl.test(url);
	}
}

module.exports = new LinkUtil();
