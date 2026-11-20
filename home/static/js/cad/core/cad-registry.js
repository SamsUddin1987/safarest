
/**
 * SAFAR EDGE CAD
 * Central Command Registry
 *
 * Responsibilities:
 * 1. Register CAD commands.
 * 2. Resolve command names and aliases.
 * 3. Provide a common execution interface.
 * 4. Supply command context.
 */

(function (global) {
    'use strict';

    const commandsByName = new Map();
    const aliases = new Map();
    const toolsByName = new Map();

    let contextProvider = null;

    function normalize(value) {
        return String(value || '').trim().toUpperCase();
    }

    const CAD = global.CAD || {};

    /**
     * Register a CAD command.
     *
     * Example:
     * CAD.registerCommand({
     *     name: "LINE",
     *     aliases: ["L"],
     *     category: "draw",
     *     execute: function(context) {}
     * });
     */
    CAD.registerCommand = function (definition) {

        if (!definition || typeof definition !== 'object') {
            throw new Error('Invalid CAD command definition.');
        }

        const name = normalize(definition.name);

        if (!name) {
            throw new Error('CAD command name is required.');
        }

        if (commandsByName.has(name) || aliases.has(name)) {
            throw new Error('Duplicate CAD command: ' + name);
        }

        const commandAliases = [
            ...new Set(
                (definition.aliases || [])
                    .map(normalize)
                    .filter(alias => alias && alias !== name)
            )
        ];

        commandAliases.forEach(alias => {
            if (commandsByName.has(alias) || aliases.has(alias)) {
                throw new Error('Duplicate CAD command alias: ' + alias);
            }
        });

        const execute =
            typeof definition.execute === 'function'
                ? definition.execute
                : null;

        const command = Object.freeze({
            name: name,
            aliases: Object.freeze(commandAliases),
            desc: definition.desc || '',
            category: definition.category || 'general',
            execute: execute,

            // Backward compatibility with existing command-line UI
            run: execute
        });

        commandsByName.set(name, command);

        commandAliases.forEach(alias => {
            aliases.set(alias, name);
        });

        return command;
    };

    /**
     * Find a command using its name or alias.
     */
    CAD.getCommand = function (identifier) {

        const key = normalize(identifier);

        const name = commandsByName.has(key)
            ? key
            : aliases.get(key);

        return name ? commandsByName.get(name) || null : null;
    };

    /**
     * Return all registered commands.
     */
    CAD.getCommands = function () {
        return Array.from(commandsByName.values());
    };

    /**
     * Register an independent CAD tool handler.
     */
    CAD.registerTool = function (name, handlers) {

        const key = normalize(name);

        if (!key) {
            throw new Error('CAD tool name is required.');
        }

        if (toolsByName.has(key)) {
            throw new Error('Duplicate CAD tool: ' + key);
        }

        if (!handlers || typeof handlers !== 'object') {
            throw new Error('Invalid CAD tool handlers.');
        }

        const tool = {};

        [
            'onClick',
            'onPreview',
            'onOption',
            'afterUndo',
            'onEnter',
            'onFinish'
        ].forEach(method => {

            if (handlers[method] !== undefined) {

                if (typeof handlers[method] !== 'function') {
                    throw new Error(
                        'Invalid handler ' + method + ' for tool ' + key
                    );
                }

                tool[method] = handlers[method];
            }

        });

        const registeredTool = Object.freeze(tool);

        toolsByName.set(key, registeredTool);

        return registeredTool;
    };


    /**
     * Retrieve an independent CAD tool handler.
     */
    CAD.getTool = function (name) {

        return toolsByName.get(normalize(name)) || null;

    };

    /**
     * Set the CAD engine context provider.
     */
    CAD.setContextProvider = function (provider) {

        if (typeof provider !== 'function') {
            throw new Error('CAD context provider must be a function.');
        }

        contextProvider = provider;
    };

    /**
     * Create a fresh command context.
     */
    CAD.createContext = function () {

        if (!contextProvider) {
            return Object.freeze({});
        }

        return contextProvider();
    };

    /**
     * Execute a command through the registry.
     */
    CAD.executeCommand = function (identifier, suppliedContext) {

        const command = CAD.getCommand(identifier);

        if (!command) {
            throw new Error('Unknown CAD command: ' + identifier);
        }

        if (!command.execute) {
            return {
                executed: false,
                implemented: false,
                command: command
            };
        }

        const context = suppliedContext || CAD.createContext();

        const result = command.execute(context);

        return {
            executed: true,
            implemented: true,
            command: command,
            result: result
        };
    };

    global.CAD = CAD;

})(window);
