interface Rooms{
    [roomId:string]: string[] | undefined;
}

const rooms: Rooms ={};

export const addUserToRoom = (roomId:string, socketId:string) =>{
    if(!rooms[roomId]){
        rooms[roomId] = [];
    }
    rooms[roomId]!.push(socketId);
    return rooms[roomId]!.filter(id => id !== socketId);
};
export const removeUserFromRoom = (socketId:string) =>{
    for(const roomId in rooms){
        rooms[roomId] = rooms[roomId]!.filter(id => id !== socketId);
    }
};
export const getRooms = () => rooms;