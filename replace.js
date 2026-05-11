const fs = require('fs');
const glob = require('glob');

const replaceMap = {
    'from-emerald-500': 'from-blue-600',
    'to-cyan-600': 'to-sky-500',
    'from-emerald-400': 'from-blue-500',
    'to-cyan-500': 'to-sky-400',
    'from-cyan-400': 'from-sky-500',
    'to-emerald-400': 'to-blue-600',
    'from-cyan-300': 'from-sky-400',
    'to-emerald-300': 'to-blue-500',
    
    'text-emerald-400': 'text-sky-400',
    'text-cyan-400': 'text-blue-400',
    'text-cyan-200': 'text-blue-300',
    'text-cyan-100': 'text-blue-200',
    'text-cyan-50': 'text-blue-50',
    'border-cyan-400': 'border-blue-400',
    'ring-cyan-400': 'ring-blue-400',
    'bg-cyan-500': 'bg-blue-500',
    'bg-cyan-900': 'bg-blue-900',
    'text-cyan-300': 'text-blue-400',

    // Extra string replace for italian
    "Home Search": "Cerca Inizio",
    "Search from Music": "Cerca brani",
    "YouTube URLs": "URL di YouTube",
    "Playlist Not Found or Private": "Playlist non trovata o privata",
    "Shared Playlist": "Playlist Condivisa"
};

const files = glob.sync('**/*.tsx', { ignore: 'node_modules/**' });

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;
    for (const [key, value] of Object.entries(replaceMap)) {
        if (content.includes(key)) {
            content = content.split(key).join(value);
            changed = true;
        }
    }
    
    // Manual replacements
    if(file.includes('Sidebar.tsx')) {
        content = content.replace("label: 'Home'", "label: 'Pagina Iniziale'");
        content = content.replace("label: 'Gemini DJ'", "label: 'DJ Automatico'");
        changed = true;
    }
    if(file.includes('MainContent.tsx')) {
        content = content.replace("Gemini Auto DJ", "DJ Automatico");
        content = content.replace("Generates a custom playlist based on your prompt, fast!", "Genera rapidamente una playlist personalizzata in base alla tua richiesta!");
        content = content.replace("Search for music or YouTube URLs...", "Cerca brani o URL di YouTube...");
        content = content.replace("My Awesome Playlist", "La mia playlist fantastica");
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Updated ${file}`);
    }
});
