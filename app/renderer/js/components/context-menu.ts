import {remote, ContextMenuParams} from 'electron';
import * as t from '../utils/translation-util';
const {clipboard, Menu} = remote;

export const contextMenu = (webContents: Electron.WebContents, event: Event, props: ContextMenuParams) => {
	const isText = Boolean(props.selectionText.length);
	const isLink = Boolean(props.linkURL);
	const isEmailAddress = Boolean(props.linkURL.startsWith('mailto:'));

	const makeSuggestion = (suggestion: string) => ({
		label: suggestion,
		visible: true,
		async click() {
			await webContents.insertText(suggestion);
		}
	});

	let menuTemplate: Electron.MenuItemConstructorOptions[] = [{
		label: t.__('Add to Dictionary'),
		visible: props.isEditable && isText && props.misspelledWord.length !== 0,
		click(_item) {
			webContents.session.addWordToSpellCheckerDictionary(props.misspelledWord);
		}
	}, {
		type: 'separator'
	}, {
		label: `${t.__('Look Up')} "${props.selectionText}"`,
		visible: process.platform === 'darwin' && isText,
		click(_item) {
			webContents.showDefinitionForSelection();
		}
	}, {
		type: 'separator'
	}, {
		label: t.__('Cut'),
		visible: isText,
		enabled: props.isEditable,
		accelerator: 'CommandOrControl+X',
		click(_item) {
			webContents.cut();
		}
	}, {
		label: t.__('Copy'),
		accelerator: 'CommandOrControl+C',
		enabled: props.editFlags.canCopy,
		click(_item) {
			webContents.copy();
		}
	}, {
		label: t.__('Paste'), // Bug: Paste replaces text
		accelerator: 'CommandOrControl+V',
		enabled: props.isEditable,
		click() {
			webContents.paste();
		}
	}, {
		type: 'separator'
	}, {
		label: isEmailAddress ? t.__('Copy Email Address') : t.__('Copy Link'),
		visible: isLink,
		click(_item) {
			clipboard.write({
				bookmark: props.linkText,
				text: isEmailAddress ? props.linkText : props.linkURL
			});
		}
	}, {
		label: t.__('Copy Image'),
		visible: props.mediaType === 'image',
		click(_item) {
			webContents.copyImageAt(props.x, props.y);
		}
	}, {
		label: t.__('Copy Image URL'),
		visible: props.mediaType === 'image',
		click(_item) {
			clipboard.write({
				bookmark: props.srcURL,
				text: props.srcURL
			});
		}
	}, {
		type: 'separator'
	}, {
		label: t.__('Services'),
		visible: process.platform === 'darwin',
		role: 'services'
	}];

	if (props.misspelledWord) {
		if (props.dictionarySuggestions.length > 0) {
			const suggestions: Electron.MenuItemConstructorOptions[] = props.dictionarySuggestions.map((suggestion: string) => makeSuggestion(suggestion));
			menuTemplate = suggestions.concat(menuTemplate);
		} else {
			menuTemplate.unshift({
				label: t.__('No Suggestion Found'),
				enabled: false
			});
		}
	}

	const menu = Menu.buildFromTemplate(menuTemplate);
	menu.popup();
};
