
/**
 * SAFAR EDGE CAD
 * Independent TEXT Command
 *
 * Features:
 * - Insertion point
 * - Text entry
 * - Canvas texture
 * - Three.js sprite creation
 * - Single-line TEXT and current MTEXT compatibility
 */

(function (global) {
    'use strict';

    const CAD = global.CAD;
    const THREE = global.THREE;

    if (!CAD || !THREE) {
        throw new Error('TEXT: CAD Registry or Three.js unavailable.');
    }

    function createTextEntity(point, textValue, context) {

        const canvas = document.createElement('canvas');

        canvas.width = 256;
        canvas.height = 64;

        const ctx = canvas.getContext('2d');

        if (!ctx) {
            throw new Error('TEXT: Unable to create canvas context.');
        }

        ctx.fillStyle = '#00ffcc';
        ctx.font = 'bold 24px Consolas, monospace';

        ctx.fillText(textValue, 10, 42);

        const texture =
            new THREE.CanvasTexture(canvas);

        const spriteMaterial =
            new THREE.SpriteMaterial({
                map: texture
            });

        const sprite = new THREE.Sprite(spriteMaterial);

        sprite.position.set(
            point.x,
            point.y,
            0
        );

        sprite.scale.set(20, 5, 1);

        sprite.userData = {
            type: 'text',
            text: textValue,
            originalColor: 0x00ffcc
        };

        context.addEntity(sprite);

        return sprite;
    }

    function onClick(point, context) {

        const input = global.prompt(
            'Enter CAD Text Value:',
            'SafarEdge CAD'
        );

        if (input) {
            createTextEntity(point, input, context);
        }

        // Keep TEXT command active
        context.setTool('text');
    }

    CAD.registerTool('text', {
        onClick: onClick
    });

    CAD.registerCommand({
        name: 'TEXT',
        aliases: ['DT', 'DTEXT'],
        desc: 'Place single-line text',
        category: 'draw',

        execute(context) {
            context.setTool('text');
        }
    });

    CAD.registerCommand({
        name: 'MTEXT',
        aliases: ['T', 'MT'],
        desc: 'Text (currently placed as single-line text)',
        category: 'draw',

        execute(context) {
            context.setTool('text');
        }
    });

})(window);
