import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	Notice,
	TFile,
	TFolder,
	ISuggestOwner,
	Scope,
	TAbstractFile,
} from "obsidian";

interface PluginSettings {
	notesFolder: string;
	ribbonButtonEnabled: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	notesFolder: "Notes",
	ribbonButtonEnabled: true,
};

const transferNote = async (app: App, baseFolder: TFolder, file: TFile) => {
	// read first tag from frontmatter
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	if (frontmatter === undefined) {
		new Notice(`Frontmatter not found for ${file.name}`);
		return;
	}
	const tags = frontmatter.tags as string[] | undefined;
	if (tags === undefined || tags === null || tags.length === 0) {
		new Notice(`Tag not found for ${file.name}`);
		return;
	}
	const category = tags[0];

	// create folder if it doesn't exist
	let folder = app.vault.getFolderByPath(`${baseFolder.path}/${category}`);
	if (folder === null) {
		try {
			folder = await app.vault.createFolder(
				`${baseFolder.path}/${category}`
			);
		} catch (e) {
			new Notice(`Folder creation failed for ${category}`);
			return;
		}
	}

	// move file to folder
	app.vault.rename(file, `${folder.path}/${file.name}`);
};

const organiseFiles = (app: App, settings: PluginSettings) => () => {
	const folder = app.vault.getFolderByPath(settings.notesFolder);
	if (folder === null) {
		new Notice("Notes folder not found.");
		return;
	}

	folder.children.forEach((file) => {
		if (file instanceof TFile) {
			transferNote(app, folder, file);
		}
	});
	new Notice("Notes organised!");
};

export default class AutoFolder extends Plugin {
	settings: PluginSettings;

	displayRibbonButton() {
		if (this.settings.ribbonButtonEnabled) {
			this.addRibbonIcon(
				"folder-heart",
				"Organise Notes",
				(evt: MouseEvent) => {
					organiseFiles(this.app, this.settings)();
				}
			);
		}
	}

	async onload() {
		await this.loadSettings();

		this.displayRibbonButton();

		this.addCommand({
			id: "auto-organise-notes",
			name: "Auto Organise Notes",
			callback: organiseFiles(this.app, this.settings),
		});

		this.addSettingTab(new SettingsTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SettingsTab extends PluginSettingTab {
	plugin: AutoFolder;

	constructor(app: App, plugin: AutoFolder) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Notes Folder")
			.setDesc("Folder containing notes to be organised")
			.addText((text) => {
				new FolderSuggest(text.inputEl);
				text.setPlaceholder("path/to/notes")
					.setValue(this.plugin.settings.notesFolder)
					.onChange(async (value) => {
						this.plugin.settings.notesFolder = value;
						await this.plugin.saveSettings();
					});

				text.inputEl.addClass("autofolder_search");
			});

		const ribbonButtonDesc = document.createDocumentFragment();
		ribbonButtonDesc.append(
			"Enable the ribbon button for auto organising notes",
			ribbonButtonDesc.createEl("br"),
			"Will only take effect after restarting Obsidian"
		);

		new Setting(containerEl)
			.setName("Ribbon Button")
			.setDesc(ribbonButtonDesc)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.ribbonButtonEnabled)
					.onChange(async (value) => {
						this.plugin.settings.ribbonButtonEnabled = value;
						await this.plugin.saveSettings();
					});
			});
	}
}

// Thanks to Templater https://github.com/SilentVoid13/Templater

import { createPopper, Instance as PopperInstance } from "@popperjs/core";

const wrapAround = (value: number, size: number): number => {
	return ((value % size) + size) % size;
};

class Suggest<T> {
	private owner: ISuggestOwner<T>;
	private values: T[];
	private suggestions: HTMLDivElement[];
	private selectedItem: number;
	private containerEl: HTMLElement;

	constructor(
		owner: ISuggestOwner<T>,
		containerEl: HTMLElement,
		scope: Scope
	) {
		this.owner = owner;
		this.containerEl = containerEl;

		containerEl.on(
			"click",
			".suggestion-item",
			this.onSuggestionClick.bind(this)
		);
		containerEl.on(
			"mousemove",
			".suggestion-item",
			this.onSuggestionMouseover.bind(this)
		);

		scope.register([], "ArrowUp", (event) => {
			if (!event.isComposing) {
				this.setSelectedItem(this.selectedItem - 1, true);
				return false;
			}
		});

		scope.register([], "ArrowDown", (event) => {
			if (!event.isComposing) {
				this.setSelectedItem(this.selectedItem + 1, true);
				return false;
			}
		});

		scope.register([], "Enter", (event) => {
			if (!event.isComposing) {
				this.useSelectedItem(event);
				return false;
			}
		});
	}

	onSuggestionClick(event: MouseEvent, el: HTMLDivElement): void {
		event.preventDefault();

		const item = this.suggestions.indexOf(el);
		this.setSelectedItem(item, false);
		this.useSelectedItem(event);
	}

	onSuggestionMouseover(_event: MouseEvent, el: HTMLDivElement): void {
		const item = this.suggestions.indexOf(el);
		this.setSelectedItem(item, false);
	}

	setSuggestions(values: T[]) {
		this.containerEl.empty();
		const suggestionEls: HTMLDivElement[] = [];

		values.forEach((value) => {
			const suggestionEl = this.containerEl.createDiv("suggestion-item");
			this.owner.renderSuggestion(value, suggestionEl);
			suggestionEls.push(suggestionEl);
		});

		this.values = values;
		this.suggestions = suggestionEls;
		this.setSelectedItem(0, false);
	}

	useSelectedItem(event: MouseEvent | KeyboardEvent) {
		const currentValue = this.values[this.selectedItem];
		if (currentValue) {
			this.owner.selectSuggestion(currentValue, event);
		}
	}

	setSelectedItem(selectedIndex: number, scrollIntoView: boolean) {
		const normalizedIndex = wrapAround(
			selectedIndex,
			this.suggestions.length
		);
		const prevSelectedSuggestion = this.suggestions[this.selectedItem];
		const selectedSuggestion = this.suggestions[normalizedIndex];

		prevSelectedSuggestion?.removeClass("is-selected");
		selectedSuggestion?.addClass("is-selected");

		this.selectedItem = normalizedIndex;

		if (scrollIntoView) {
			selectedSuggestion.scrollIntoView(false);
		}
	}
}

export abstract class TextInputSuggest<T> implements ISuggestOwner<T> {
	protected inputEl: HTMLInputElement | HTMLTextAreaElement;

	private popper: PopperInstance;
	private scope: Scope;
	private suggestEl: HTMLElement;
	private suggest: Suggest<T>;

	constructor(inputEl: HTMLInputElement | HTMLTextAreaElement) {
		this.inputEl = inputEl;
		this.scope = new Scope();

		this.suggestEl = createDiv("suggestion-container");
		const suggestion = this.suggestEl.createDiv("suggestion");
		this.suggest = new Suggest(this, suggestion, this.scope);

		this.scope.register([], "Escape", this.close.bind(this));

		this.inputEl.addEventListener("input", this.onInputChanged.bind(this));
		this.inputEl.addEventListener("focus", this.onInputChanged.bind(this));
		this.inputEl.addEventListener("blur", this.close.bind(this));
		this.suggestEl.on(
			"mousedown",
			".suggestion-container",
			(event: MouseEvent) => {
				event.preventDefault();
			}
		);
	}

	onInputChanged(): void {
		const inputStr = this.inputEl.value;
		const suggestions = this.getSuggestions(inputStr);

		if (!suggestions) {
			this.close();
			return;
		}

		if (suggestions.length > 0) {
			this.suggest.setSuggestions(suggestions);
			// @ts-ignore
			this.open(app.dom.appContainerEl, this.inputEl);
		} else {
			this.close();
		}
	}

	open(container: HTMLElement, inputEl: HTMLElement): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		// @ts-ignore
		app.keymap.pushScope(this.scope);

		container.appendChild(this.suggestEl);
		this.popper = createPopper(inputEl, this.suggestEl, {
			placement: "bottom-start",
			modifiers: [
				{
					name: "sameWidth",
					enabled: true,
					fn: ({ state, instance }) => {
						// Note: positioning needs to be calculated twice -
						// first pass - positioning it according to the width of the popper
						// second pass - position it with the width bound to the reference element
						// we need to early exit to avoid an infinite loop
						const targetWidth = `${state.rects.reference.width}px`;
						if (state.styles.popper.width === targetWidth) {
							return;
						}
						state.styles.popper.width = targetWidth;
						instance.update();
					},
					phase: "beforeWrite",
					requires: ["computeStyles"],
				},
			],
		});
	}

	close(): void {
		// @ts-ignore
		app.keymap.popScope(this.scope);

		this.suggest.setSuggestions([]);
		if (this.popper) this.popper.destroy();
		this.suggestEl.detach();
	}

	abstract getSuggestions(inputStr: string): T[];
	abstract renderSuggestion(item: T, el: HTMLElement): void;
	abstract selectSuggestion(item: T): void;
}

class FolderSuggest extends TextInputSuggest<TFolder> {
	getSuggestions(inputStr: string): TFolder[] {
		// @ts-ignore
		const abstractFiles = app.vault.getAllLoadedFiles();
		const folders: TFolder[] = [];
		const lowerCaseInputStr = inputStr.toLowerCase();

		abstractFiles.forEach((folder: TAbstractFile) => {
			if (
				folder instanceof TFolder &&
				folder.path.toLowerCase().contains(lowerCaseInputStr)
			) {
				folders.push(folder);
			}
		});

		return folders.slice(0, 1000);
	}

	renderSuggestion(file: TFolder, el: HTMLElement): void {
		el.setText(file.path);
	}

	selectSuggestion(file: TFolder): void {
		this.inputEl.value = file.path;
		this.inputEl.trigger("input");
		this.close();
	}
}
