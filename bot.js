const Discord = require("discord.js");
const Client = new Discord.Client();

const TOKEN = require("./token.json");

const RULE_CHANNEL = "rules";
const CONSTITUTION_CHANNEL = "constitution";
const VOTES_CHANNEL = "votes";
const MODERATOR_ROLE = "Moderator";
const RULE_VOTE_TIME = 7 * 24 * 60 * 60 * 1000; //7 days to vote on things
const APPROVE_EMOJI = "\u2705"; // ✅
const DISPROVE_EMOJI = "\u274C"; // ❌

const prefix = "&";

function formatDate(d) {
    return d.toString();
}

/* -- Structures -- */
//Anything people can vote on: Adding rules
class Vote {
    constructor (type, democracy, channel, content) {
        this.democracy = democracy;
        
        // this.endTime
        
        this.votedFor = new Set();
        this.votedAgainst = new Set();
        
        this.type = type;
        
        this.content = content;
        
        this.complete = false;
        // this.passed; //Once it's complete, true if it passed, false otherwise
        
        // this.message //The message in the #votes channel that corresponds to this proposed rule.
        
        switch (this.type) {
            case "ADDRULE":
            this.endTime = new Date(Date.now() + RULE_VOTE_TIME);
            
            // Send a message in #votes with info about the vote (inc. end time)
            this.democracy.votesChannel.send("Vote info pending...").then(message => {
                this.message = message;
                
                this.updateMessage();
                
                //React to the message
                this.message.react(APPROVE_EMOJI);
                this.message.react(DISPROVE_EMOJI);
                
                Client.on("messageReactionAdd", (reaction, user) => {
                    if (reaction.message.id !== this.message.id //If it's a different message
                    || user.id === Client.user.id //Or it's out base vote
                    || this.complete //Or voting is over
                    ) {
                        return false; //Just ignore it
                    }
                    
                    if (!this.democracy.server.member(user).roles.has(this.democracy.moderatorRole.id) || //they're not a moderator or
                    (   reaction.emoji.name !== APPROVE_EMOJI &&
                    reaction.emoji.name !== DISPROVE_EMOJI) //It's not a valid emoji
                    ) {
                        console.log("Removing invalid vote.");
                        reaction.remove(user);
                        
                        return false;
                    }
                    
                    //Save the vote
                    if (reaction.emoji.name === APPROVE_EMOJI) {
                        this.votedFor.add(user);
                        this.votedAgainst.delete(user);
                    }else if (reaction.emoji.name === DISPROVE_EMOJI) {
                        this.votedAgainst.add(user);
                        this.votedFor.delete(user);
                    }else {
                        throw new Error("Invalid Reaction");
                    }
                    
                    //Remove the reaction
                    reaction.remove(user);
                    this.updateMessage();
                })
                
                // Set a timer to end the vote
                setTimeout(() => {
                    // Add or don't add the rule
                    this.complete = true;
                    this.passed = this.votedFor.size > this.votedAgainst.size;
                    // If we have more postive than negative votes
                    if (this.passed) {
                        //Add the rule
                        this.democracy.addRule(this);
                    }
                    
                    //TODO?: Remove from this.democracy.votes
                    
                    this.updateMessage();
                }, this.endTime.getTime() - Date.now());
            }).catch(console.error);
            
            break;
            default:
            throw new Error("Unrecognized Vote type");
        }
    }
    
    //TODO?: Make this an embed
    updateMessage () {
        const numVotes = this.votedFor.size + this.votedAgainst.size;
        
        let messageText;
        if (!this.complete) {
            messageText = 
            `Rule Proposal:
> ${this.content}
Current votes: ${numVotes}. Voting will end at ${formatDate(this.endTime)}. Vote by reacting below.`;
        }else {
            //TODO: Include the people voting for and against
            messageText = `Rule ${this.passed ? "passed" : "rejected"}: ${this.votedFor.size} for, ${this.votedAgainst.size} against.\n> ${this.content}\nVoting ended at ${formatDate(new Date())}.`;
        }
        
        this.message.edit(messageText);
    }
}

//One Democracy corresponds to one server.
class Democracy {
    constructor (server) {
        this.server = server;
        this.member = server.member(Client.user);
        this.rules = []; //List of messages RN
        this.votes = []; //List of Votes
        
        this.doneSetup = false;
        
        // this.rulesChannel
        // this.constChannel
        // this.votesChannel
        
        // this.moderatorRole
    }
    
    sendMessage (message, invokedChannel) {
        const sendChannel = invokedChannel || this.server.systemChannel;
        const perms = sendChannel.memberPermissions(this.member);
        if (perms.has("SEND_MESSAGES")) {
            sendChannel.send(message);
        }else {
            this.member.setNickname(`Can't talk in #${defaultChannel.name}`, `I wanted to say "${message}"`);
            throw new Error("No system channel talking perms.");
        }
    }
    
    //init is called by setup once per server on bot start, or can be called with the `init` command
    //TODO?: Divide into 2 one functions, one to load rules from the rules channel, one to check that the bot has all the correct perms and channels and roles
    init (invokedChannel) {
        if (this.doneSetup) {
            this.sendMessage(`This server is already a democracy. (Use ${prefix}teardown to destroy it.)`, invokedChannel);
            return;
        }
        if (!this.server.available) { console.error("Guild not available."); }
        
        //Set up channels
        const manageChannelNames = [RULE_CHANNEL, CONSTITUTION_CHANNEL, VOTES_CHANNEL]; //Temp list of the channels we need perms in.
        const manageChannels = [];
        
        for (let channelName of manageChannelNames) {
            console.log(channelName);
            let channel = this.server.channels.find(c => c.name === channelName);
            if (channel) {
                if (!channel.memberPermissions(this.member).has(["SEND_MESSAGES", "MANAGE_MESSAGES"])) {
                    this.sendMessage(`I need SEND_MESSAGES and MANAGE_MESSAGES in ${channel}.`);
                    return;
                }else {
                    manageChannels.push(channel);
                }
            }else {
                this.sendMessage(`To set up a democracy, I need a #${channelName} channel.`, invokedChannel);
                return;
            }
        }

        [this.rulesChannel, this.constChannel, this.votesChannel] = manageChannels;
        
        this.moderatorRole = this.server.roles.find(r => r.name === "Moderator");
        if (!this.moderatorRole) {
            this.sendMessage(`To set up a democracy, I need a @${MODERATOR_ROLE} role.`, invokedChannel);
        }
        
        
        //Load rules from the rules channel
        this.rulesChannel.fetchMessages({ limit: 100 }).then(oldRules => {
            if (oldRules.size === 100) {
                this.sendMessage("WARN I only fetched the last 100 messages from #rules.", invokedChannel);
            }
            let notOurRules = false;
            oldRules.forEach(message => {
                if (message.author.id === Client.user.id) {
                    //Easy money!
                    this.rules.push(message);
                }else {
                    notOurRules = true;
                    console.warn(`Ignoring message in rules channel.`);
                }
            });
            if (notOurRules) {
                this.sendMessage(`One or more messages in #rules were not sent by me. These messages were ignored and are not being counted as rules. If you'd like to add them, use the normal: ${prefix}addrule.`, invokedChannel);
            }
            this.doneSetup = true;
        }).catch(console.error);
        
        //TODO: Re-enable after debugging
        // this.sendMessage("WARN Any votes that were in-progress when I shut down have been lost.");
    }
    
    startRuleVote(message, content) {
        // Check if the message author is authorized
        if (message.member.roles.has(this.moderatorRole.id)) {
            // Add it to the Votes list
            this.votes.push(new Vote("ADDRULE", this, message.channel, content));
            message.channel.send(`Rule Proposal logged. Vote in ${this.votesChannel}. Voting ends in 1 week.`);
        }else {
            this.sendMessage(`You need the ${MODERATOR_ROLE} role to propose a rule.`, message.channel);
        }
    }
    
    addRule(vote) {
        //Send a message in the #rules channel
        //TODO?: Make not ugly
        this.rulesChannel.send(`RULE:\n> ${vote.content}`);
    }
}

const commands = [
{
    name: "init",
    perms: "ADMINISTRATOR",
    func: function (message, _, demo) {
        demo.init(message.channel);
    }
},
{
    name: "addrule",
    perms: [], 
    func: function (message, content, demo) {
        //Grab text in between quotes as the rule text
        content = content.match(/"(.*)"/);
        if (!content) {
            demo.sendMessage("Please include the text of the proposed rule in quotes.", message.channel);
        }else {
            demo.startRuleVote(message, content[1]);
        }
    }
},
{
    name: "list",
    perms: [],
    func: function (message, content, demo) {
        //TODO: Polish
        if (content.includes("vote")) {
            demo.sendMessage(demo.votes.map(v => `${v.type}: ${v.message.id}`).join(",\n"), message.channel);
        }else if (content.includes("rule")) {
            demo.sendMessage(demo.rules.map(r => r.content).join(",\n"), message.channel);
        }
    },
}
]

const democracies = [];

Client.on("ready", () => {
    // Client.user.setPresence({
    //     status: "idle",
    //     game: { name: "for servers", type: "Scanning" }
    // });
    
    Client.guilds.forEach(guild => {
        const demo = new Democracy(guild);
        democracies.push(demo);
        demo.init();
    });
});

Client.on("message", (message) => {
    if (message.content.startsWith(prefix)) {
        const content = message.content;
        //Lowercase, starting past the prefix, grab until the first space or to the end of the string
        const commandName = content.toLowerCase().substring(prefix.length, (content.indexOf(" ") +1 || content.length +1) -1);
        const command = commands.find(c => c.name === commandName);
        if (command && message.channel.memberPermissions(message.author).has(command.perms || [])) {
            const demo = democracies.find(demo => demo.server.id === message.guild.id);
            
            //message, content after the `& `, democracy. 
            command.func(message, content.slice((prefix + commandName).length + 1), demo)
        }
    }
});

Client.login(TOKEN);
    
